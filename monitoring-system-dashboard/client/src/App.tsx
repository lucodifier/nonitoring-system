import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import Home from "./pages/Home";
import Services from "./pages/Services";
import ServiceDetails from "./pages/ServiceDetails";
import Deployment from "./pages/Deployment";
import Login from "./pages/Login";
import Logs from "./pages/Logs";
import Alerts from "./pages/Alerts";
import Vms from "./pages/Vms";
import VmDetails from "./pages/VmDetails";
import { useEffect } from "react";

function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return <Layout>{children}</Layout>;
}

function Router() {
  const { isAuthenticated, isLoading } = useAuth();
  const [location, setLocation] = useLocation();

  // Redireciona baseado no estado de autenticação
  useEffect(() => {
    if (isLoading) return; // Aguarda verificação de auth
    
    // Se está autenticado e está em /login, vai para home
    if (isAuthenticated && location === '/login') {
      setLocation('/');
    }
  }, [isLoading, isAuthenticated, location, setLocation]);

  // Mostra loading apenas durante verificação inicial
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-mono text-primary animate-pulse">VERIFYING...</span>
        </div>
      </div>
    );
  }

  return (
    <Switch>
      <Route path="/login" component={Login} />
      
      {/* Protected Routes wrapped in Layout */}
      <ProtectedRoute component={() => (
        <AuthenticatedLayout>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/services" component={Services} />
            <Route path="/services/:id" component={ServiceDetails} />
            <Route path="/vms" component={Vms} />
            <Route path="/vms/:id" component={VmDetails} />
            <Route path="/deployment" component={Deployment} />
            <Route path="/metrics" component={() => <div>Metrics Page (Coming Soon)</div>} />
            <Route path="/alerts" component={Alerts} />
            <Route path="/logs" component={Logs} />
            <Route component={NotFound} />
          </Switch>
        </AuthenticatedLayout>
      )} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster position="top-right" theme="dark" />
          <AuthProvider>
            <Router />
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
