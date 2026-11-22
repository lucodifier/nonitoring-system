import { useAuth } from '@/contexts/AuthContext';
import { Redirect, Route } from 'wouter';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  path?: string;
  component: React.ComponentType<any>;
}

export default function ProtectedRoute({ component: Component }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading } = useAuth();

  // Se ainda está carregando, mostra loading
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <span className="text-xs font-mono text-primary animate-pulse">VERIFYING CREDENTIALS...</span>
        </div>
      </div>
    );
  }

  // Se não está autenticado, redireciona para login
  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  // Se está autenticado, renderiza o componente
  return <Component />;
}
