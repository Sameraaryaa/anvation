import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { Overview } from './pages/Overview';
import { Remediation } from './pages/Remediation';
import { Hardware } from './pages/Hardware';
import { Cards } from './pages/Cards';
import { Audit } from './pages/Audit';

export const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-bg text-ink flex flex-col font-sans">
      <Navbar />
      <div className="flex-1 pb-12">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/remediation" element={<Remediation />} />
          <Route path="/hardware" element={<Hardware />} />
          <Route path="/cards" element={<Cards />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
};
