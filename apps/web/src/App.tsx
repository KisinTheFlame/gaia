import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { ConfigWorkbenchPage } from "@/pages/configs/ConfigWorkbenchPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/configs" replace />} />
          <Route path="/configs" element={<ConfigWorkbenchPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
