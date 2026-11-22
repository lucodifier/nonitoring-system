import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Activity, Lock, User, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Redirect } from 'wouter';

export default function Login() {
  const { login, isAuthenticated, isLoading } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Mostra loading enquanto verifica autenticação
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

  // Redireciona se já estiver autenticado
  if (isAuthenticated) {
    return <Redirect to="/" />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await api.post('/auth/login', { username, password });
      const { access_token, user } = response.data;
      login(access_token, user);
    } catch (error: any) {
      console.error('Login error:', error);
      toast.error(error.response?.data?.message || 'Login failed. Check your credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)]" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/20 blur-[100px] rounded-full pointer-events-none" />

      <Card className="w-full max-w-md cyber-card border-primary/30 shadow-[0_0_50px_-10px_var(--color-primary)] relative z-10">
        <CardHeader className="text-center space-y-2 pb-2">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 border border-primary/50 flex items-center justify-center mb-2 shadow-[0_0_15px_var(--color-primary)]">
            <Activity className="w-6 h-6 text-primary animate-pulse" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-wider text-glow">SYSTEM ACCESS</CardTitle>
          <CardDescription className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
            Secure Terminal Login
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-xs font-mono uppercase text-primary/80">Identity</Label>
              <div className="relative group">
                <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <Input
                  id="username"
                  placeholder="ENTER USERNAME"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="pl-9 bg-background/50 border-border/50 focus:border-primary/50 font-mono tracking-wide"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-xs font-mono uppercase text-primary/80">Passcode</Label>
              <div className="relative group">
                <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9 bg-background/50 border-border/50 focus:border-primary/50 font-mono tracking-wide"
                  required
                />
              </div>
            </div>
            
            <Button 
              type="submit" 
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-bold tracking-widest shadow-[0_0_20px_-5px_var(--color-primary)] transition-all duration-300"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  AUTHENTICATING...
                </>
              ) : (
                'INITIALIZE SESSION'
              )}
            </Button>

            <div className="text-center text-[10px] text-muted-foreground font-mono pt-4 border-t border-border/30">
              <p>UNAUTHORIZED ACCESS IS STRICTLY PROHIBITED</p>
              <p className="mt-1 opacity-50">SYSTEM ID: Monitoring</p>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
