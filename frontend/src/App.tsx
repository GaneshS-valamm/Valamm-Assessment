import { Navigate, Route, Routes } from 'react-router-dom';
import { auth } from './services/api';
import AdminLayout from './layouts/AdminLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import GenerateAssessment from './pages/GenerateAssessment';
import Candidates from './pages/Candidates';
import QuestionPapers from './pages/QuestionPapers';
import Resumes from './pages/Resumes';
import AssessmentResults from './pages/AssessmentResults';
import CandidateAssessment from './pages/CandidateAssessment';

function RequireAuth({ children }: { children: React.ReactNode }) {
  return auth.token ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      {/* Candidate app - token only, no login */}
      <Route path="/assessment/:token" element={<CandidateAssessment />} />

      {/* Admin app */}
      <Route path="/login" element={auth.token ? <Navigate to="/admin" replace /> : <Login />} />
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="generate" element={<GenerateAssessment />} />
        <Route path="candidates" element={<Candidates />} />
        <Route path="resumes" element={<Resumes />} />
        <Route path="question-papers" element={<QuestionPapers />} />
        <Route path="results/:assessmentId" element={<AssessmentResults />} />
      </Route>

      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
