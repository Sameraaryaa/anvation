import React, { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { Overview } from './pages/Overview';
import { Remediation } from './pages/Remediation';
import { Hardware } from './pages/Hardware';
import { Cards } from './pages/Cards';
import { Audit } from './pages/Audit';

export const App: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-[#F8FAFD] text-[#202124] flex flex-col font-sans antialiased">
      <Navbar onToggleSidebar={() => setSidebarOpen((prev) => !prev)} />
      <div className="flex-1 flex min-h-0 relative">
        <Sidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        />
        <main className="flex-1 min-w-0 overflow-y-auto bg-[#F8FAFD]">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/remediation" element={<Remediation />} />
            <Route path="/hardware" element={<Hardware />} />
            <Route path="/cards" element={<Cards />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
};
