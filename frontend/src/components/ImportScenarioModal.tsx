import React, { useState } from 'react';
import { X, Upload, FileText, CheckCircle2, AlertCircle, Sparkles, Layers } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';

interface ImportScenarioModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SAMPLE_JSON_TEMPLATE = {
  scenario: "custom_cloud_stack",
  display_name: "Custom Synthetic Cloud Stack",
  entry_points: ["internet"],
  crown_jewels: ["customer_db"],
  nodes: [
    { id: "internet", type: "internet", label: "Public Internet", exposed: true },
    { id: "api_gateway", type: "compute", label: "Public API Gateway", public: true, misconfig: ["unauthenticated_route"] },
    { id: "backend_lambda", type: "compute", label: "Data Processor Lambda", misconfig: ["env_var_creds"] },
    { id: "role_db_admin", type: "role", label: "RDS Admin Role", misconfig: ["full_rds_access"] },
    { id: "customer_db", type: "data", label: "Customer DB (Postgres)", crown_jewel: true, value: 10, sensitivity: "pii" }
  ],
  edges: [
    { from: "internet", to: "api_gateway", type: "HTTP_TRAFFIC", technique: "T1190", difficulty: 1 },
    { from: "api_gateway", to: "backend_lambda", type: "INVOKE_FUNCTION", technique: "T1059", difficulty: 2 },
    { from: "backend_lambda", to: "role_db_admin", type: "ASSUME_ROLE", technique: "T1078.004", difficulty: 2, fixable: true, fix: "restrict_lambda_role" },
    { from: "role_db_admin", to: "customer_db", type: "SQL_CONNECT", technique: "T1530", difficulty: 1 }
  ],
  remediations: {
    restrict_lambda_role: {
      title: "Revoke RDS Admin AssumeRole from Lambda",
      detail: "Restrict Lambda execution role to read-only replica with scoped KMS permissions.",
      removes_edges: [["backend_lambda", "role_db_admin"]],
      iam_before: { Effect: "Allow", Action: "sts:AssumeRole", Resource: "*" },
      iam_after: { Effect: "Deny", Action: "sts:AssumeRole", Resource: "arn:aws:iam::ACCOUNT:role/RDSAdmin" },
      terraform_after: "resource \"aws_iam_role_policy\" \"lambda_safe\" {\n  name = \"lambda-least-privilege\"\n}",
      rego: "deny[msg] { input.Action == \"sts:AssumeRole\"; input.Resource == \"*\"; msg := \"Wildcard AssumeRole forbidden\" }"
    }
  }
};

const SAMPLE_CLOUDBOAT_TF = `# CloudGoat: Cloud Breach S3 Scenario (Rhino Security Labs)
# Vulnerable reverse-proxy EC2 server to confidential cardholder S3 bucket

resource "aws_iam_role" "cg-banking-WAF-Role" {
  name = "cg-banking-WAF-Role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Principal = { Service = "ec2.amazonaws.com" }
      Effect    = "Allow"
    }]
  })
  managed_policy_arns = [
    "arn:aws:iam::aws:policy/AmazonS3FullAccess"
  ]
}

resource "aws_security_group" "cg-ec2-http-security-group" {
  name        = "cg-ec2-http"
  description = "Open HTTP ingress proxy"
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "ec2-vulnerable-proxy-server" {
  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = "t2.micro"
}

resource "aws_s3_bucket" "cg-cardholder-data-bucket" {
  bucket = "cg-cardholder-data-bucket-confidential"
}`;

export const ImportScenarioModal: React.FC<ImportScenarioModalProps> = ({ isOpen, onClose }) => {
  const { refreshScenarios, setSelectedScenario, runAnalysis } = useApp();
  const { addToast } = useToast();

  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [inputText, setInputText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [detectedFormat, setDetectedFormat] = useState<'json' | 'terraform' | null>(null);
  const [parsedData, setParsedData] = useState<any | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const inspectContent = (text: string, currentFileName?: string | null) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setParsedData(null);
      setValidationError(null);
      setDetectedFormat(null);
      return;
    }

    const isTf = (currentFileName && currentFileName.endsWith('.tf')) ||
                 trimmed.includes('resource "') ||
                 trimmed.includes('provider "') ||
                 trimmed.includes('variable "');

    if (isTf) {
      // Terraform HCL format
      setDetectedFormat('terraform');
      const resMatches = Array.from(trimmed.matchAll(/resource\s+"([^"]+)"\s+"([^"]+)"/g));
      if (resMatches.length === 0) {
        setValidationError('No Terraform resource blocks (resource "type" "name") found.');
        setParsedData(null);
      } else {
        const resourceTypes = resMatches.map(m => m[1]);
        setParsedData({
          format: 'terraform',
          scenario: 'cloudgoat_tf_import',
          display_name: 'CloudGoat Terraform Infrastructure',
          resourcesCount: resMatches.length,
          resourceTypes: Array.from(new Set(resourceTypes)),
        });
        setValidationError(null);
      }
    } else {
      // Try JSON format
      setDetectedFormat('json');
      try {
        const parsed = JSON.parse(trimmed);
        if (!parsed.scenario) throw new Error("Missing required field 'scenario' ID");
        if (!parsed.nodes || !Array.isArray(parsed.nodes) || parsed.nodes.length === 0) {
          throw new Error("Scenario must contain at least 1 node in 'nodes' array");
        }
        if (!parsed.edges || !Array.isArray(parsed.edges)) {
          throw new Error("Missing 'edges' array");
        }
        setParsedData(parsed);
        setValidationError(null);
      } catch (err: any) {
        setParsedData(null);
        setValidationError(err.message || 'Invalid JSON syntax');
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      setInputText(content);
      inspectContent(content, file.name);
    };
    reader.readAsText(file);
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);
    inspectContent(val, fileName);
  };

  const handleLoadJsonSample = () => {
    const formatted = JSON.stringify(SAMPLE_JSON_TEMPLATE, null, 2);
    setInputText(formatted);
    setFileName('sample_template.json');
    inspectContent(formatted, 'sample_template.json');
  };

  const handleLoadCloudGoatTf = () => {
    setInputText(SAMPLE_CLOUDBOAT_TF);
    setFileName('cloudgoat_cloud_breach.tf');
    inspectContent(SAMPLE_CLOUDBOAT_TF, 'cloudgoat_cloud_breach.tf');
  };

  const handleSubmit = async (autoAnalyze: boolean = true) => {
    if (!parsedData) return;
    setIsSubmitting(true);
    try {
      let payload: any;
      if (detectedFormat === 'terraform') {
        const cleanName = fileName ? fileName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase() : 'cloudgoat_tf_import';
        const prettyName = fileName ? fileName.replace(/\.[^/.]+$/, '') : 'Terraform Infrastructure';
        payload = {
          terraform: inputText,
          scenario: cleanName,
          display_name: `Terraform: ${prettyName}`
        };
      } else {
        payload = parsedData;
      }

      const res = await api.importScenario(payload);
      await refreshScenarios();
      setSelectedScenario(res.scenario);
      addToast({
        type: 'success',
        title: 'Architecture Imported',
        message: `Successfully synthesized attack graph for "${res.display_name}".`,
      });
      onClose();
      if (autoAnalyze) {
        setTimeout(() => {
          runAnalysis(res.scenario);
        }, 300);
      }
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Import Failed',
        message: err.message || 'Could not import architecture',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-white border border-line rounded-card shadow-2xl max-w-2xl w-full flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-violet/10 text-violet flex items-center justify-center font-bold">
              <Upload className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-ink leading-tight">Import Infrastructure & Attack Data</h3>
              <p className="text-xs text-mute">Supports Terraform (*.tf) files, CloudGoat HCL code, or AEGIS Scenario JSON</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-mute hover:text-ink transition-colors p-1 rounded-lg hover:bg-bg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab & Presets */}
        <div className="px-6 pt-3 flex flex-wrap items-center justify-between gap-2 border-b border-line/60 bg-bg/50">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('upload')}
              className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'upload'
                  ? 'border-violet text-violet font-bold'
                  : 'border-transparent text-slate hover:text-ink'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload File (*.tf or *.json)</span>
            </button>
            <button
              onClick={() => setActiveTab('paste')}
              className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'paste'
                  ? 'border-violet text-violet font-bold'
                  : 'border-transparent text-slate hover:text-ink'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Paste Code / Editor</span>
            </button>
          </div>
          <div className="flex items-center gap-2 pb-2">
            <button
              onClick={handleLoadCloudGoatTf}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet hover:underline px-2.5 py-1 rounded bg-violet/10 hover:bg-violet/20 transition-colors"
              title="Load real Terraform from Rhino Security Labs CloudGoat"
            >
              <Layers className="w-3 h-3 text-violet" />
              <span>Paste CloudGoat .tf</span>
            </button>
            <button
              onClick={handleLoadJsonSample}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate hover:text-ink hover:underline px-2.5 py-1 rounded bg-line hover:bg-slate/20 transition-colors"
            >
              <Sparkles className="w-3 h-3" />
              <span>Paste JSON</span>
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1 text-xs">
          {activeTab === 'upload' ? (
            <div className="space-y-4">
              <label className="border-2 border-dashed border-line hover:border-violet/60 transition-colors rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer bg-bg/30 hover:bg-violet/5">
                <Upload className="w-8 h-8 text-violet mb-2" />
                <span className="font-bold text-ink text-sm">
                  {fileName ? fileName : 'Choose a Terraform (*.tf) or Scenario (*.json) file'}
                </span>
                <span className="text-[11px] text-mute mt-1">
                  Drag & drop from your Downloads folder (e.g. CloudGoat ec2.tf, s3.tf, iam.tf)
                </span>
                <input
                  type="file"
                  accept=".tf,.json,text/plain,application/json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              {inputText && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-mute">
                    <span>File Preview ({fileName})</span>
                    <span>{inputText.length} bytes · {detectedFormat === 'terraform' ? 'Terraform HCL' : 'JSON'}</span>
                  </div>
                  <pre className="p-3 bg-bg border border-line rounded-xl max-h-40 overflow-auto font-mono text-[11px] text-slate">
                    {inputText.slice(0, 1000)}
                    {inputText.length > 1000 && '\n... (truncated)'}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-mute">
                <span>Enter Terraform HCL or Scenario JSON</span>
                <span className="font-bold text-violet">
                  {detectedFormat === 'terraform' ? '⚡ Terraform Detected' : (detectedFormat === 'json' ? '✓ JSON Detected' : 'Auto-detecting...')}
                </span>
              </div>
              <textarea
                value={inputText}
                onChange={handleTextChange}
                placeholder="Paste your Terraform code (resource &quot;...&quot;) or Scenario JSON here..."
                rows={12}
                className="w-full bg-bg border border-line rounded-xl p-3 font-mono text-[11px] text-ink focus:outline-none focus:ring-2 focus:ring-violet/30"
              />
            </div>
          )}

          {/* Validation Feedback */}
          {validationError && (
            <div className="p-3 rounded-xl bg-redsoft border border-red/20 text-red flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Validation Error:</span> {validationError}
              </div>
            </div>
          )}

          {/* Validated preview */}
          {parsedData && (
            <div className="p-3.5 rounded-xl bg-greensoft border border-green/30 text-ink space-y-2">
              <div className="flex items-center gap-2 font-bold text-green">
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {detectedFormat === 'terraform'
                    ? 'Terraform Code Validated — Ready to Synthesize Attack Graph'
                    : 'Scenario Validated & Ready to Import'}
                </span>
              </div>
              {detectedFormat === 'terraform' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                  <div className="bg-white/80 p-2 rounded-lg border border-green/20">
                    <span className="text-mute block text-[10px] uppercase font-bold">IaC Source</span>
                    <span className="font-mono font-bold text-violet">Terraform HCL</span>
                  </div>
                  <div className="bg-white/80 p-2 rounded-lg border border-green/20">
                    <span className="text-mute block text-[10px] uppercase font-bold">Resources Found</span>
                    <span className="font-bold text-ink">{parsedData.resourcesCount} Cloud Resources</span>
                  </div>
                  <div className="bg-white/80 p-2 rounded-lg border border-green/20">
                    <span className="text-mute block text-[10px] uppercase font-bold">Types</span>
                    <span className="font-semibold text-ink truncate block">
                      {parsedData.resourceTypes?.join(', ')}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                  <div className="bg-white/80 p-2 rounded-lg border border-green/20">
                    <span className="text-mute block text-[10px] uppercase font-bold">ID</span>
                    <span className="font-mono font-bold text-ink">{parsedData.scenario}</span>
                  </div>
                  <div className="bg-white/80 p-2 rounded-lg border border-green/20">
                    <span className="text-mute block text-[10px] uppercase font-bold">Display Name</span>
                    <span className="font-semibold text-ink truncate block">{parsedData.display_name}</span>
                  </div>
                  <div className="bg-white/80 p-2 rounded-lg border border-green/20">
                    <span className="text-mute block text-[10px] uppercase font-bold">Topology</span>
                    <span className="font-semibold text-ink">
                      {parsedData.nodes?.length || 0} nodes · {parsedData.edges?.length || 0} edges
                    </span>
                  </div>
                  <div className="bg-white/80 p-2 rounded-lg border border-green/20">
                    <span className="text-mute block text-[10px] uppercase font-bold">Targets</span>
                    <span className="font-semibold text-ink">
                      {parsedData.crown_jewels?.length || 0} Crown Jewel(s)
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-line flex items-center justify-between bg-bg/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate hover:text-ink rounded-xl border border-line hover:bg-white transition-colors"
          >
            Cancel
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!parsedData || isSubmitting}
              onClick={() => handleSubmit(false)}
              className="px-4 py-2 text-xs font-semibold text-ink bg-white border border-line hover:border-slate/40 rounded-xl transition-colors disabled:opacity-40"
            >
              Import Only
            </button>
            <button
              type="button"
              disabled={!parsedData || isSubmitting}
              onClick={() => handleSubmit(true)}
              className="px-4 py-2 text-xs font-bold text-white bg-violet hover:bg-violet/90 rounded-xl shadow-sm transition-all disabled:opacity-40 flex items-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Synthesizing...' : 'Import & Analyze'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
