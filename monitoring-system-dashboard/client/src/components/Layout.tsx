import { useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Server, 
  Activity, 
  AlertTriangle, 
  Settings, 
  LogOut, 
  Menu, 
  X,
  ShieldCheck,
  Terminal,
  HardDrive
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/contexts/AuthContext";

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { logout, user } = useAuth();

  const navItems = [
    { icon: LayoutDashboard, label: "Dashboard", path: "/" },
    { icon: Server, label: "Services", path: "/services" },
    { icon: HardDrive, label: "VMs", path: "/vms" },
    { icon: Activity, label: "Metrics", path: "/metrics" },
    { icon: AlertTriangle, label: "Alerts", path: "/alerts" },
    { icon: ShieldCheck, label: "Deployment", path: "/deployment" },
    { icon: Terminal, label: "Logs", path: "/logs" },
  ];

  return (
    <div className="min-h-screen flex bg-background text-foreground overflow-hidden">
      {/* Sidebar Backdrop (Mobile) */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside 
        className={cn(
          "fixed lg:static inset-y-0 left-0 z-50 w-64 bg-sidebar border-r border-sidebar-border transition-transform duration-300 ease-in-out flex flex-col",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0 lg:w-20"
        )}
      >
        {/* Logo Area */}
        <div className="h-16 flex items-center justify-center border-b border-sidebar-border relative overflow-hidden">
          <div className="absolute inset-0 bg-primary/5" />
          {sidebarOpen ? (
            <div className="flex items-center gap-2 font-bold text-xl tracking-wider text-primary">
              <Activity className="w-6 h-6" />
              <span className="text-glow">Monitoring</span>
            </div>
          ) : (
            <Activity className="w-8 h-8 text-primary animate-pulse" />
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-6 px-3 space-y-2 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.path;
            return (
              <Link 
                key={item.path} 
                href={item.path}
                className={cn(
                  "flex items-center gap-3 px-3 py-3 rounded-md transition-all duration-200 group relative overflow-hidden",
                  isActive 
                    ? "bg-sidebar-accent text-primary border border-primary/20 shadow-[0_0_15px_-5px_var(--color-primary)]" 
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-primary"
                )}
                title={!sidebarOpen ? item.label : undefined}
              >
                {isActive && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary shadow-[0_0_10px_var(--color-primary)]" />
                )}
                <item.icon className={cn("w-5 h-5 shrink-0", isActive && "text-primary")} />
                {sidebarOpen && (
                  <span className="font-medium tracking-wide text-sm">{item.label}</span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* User Profile */}
        <div className="p-4 border-t border-sidebar-border bg-sidebar-accent/10">
          <div className={cn("flex items-center gap-3", !sidebarOpen && "justify-center")}>
            <Avatar className="w-9 h-9 border border-primary/30 ring-2 ring-primary/10">
              <AvatarImage src="https://github.com/shadcn.png" />
              <AvatarFallback className="bg-primary/20 text-primary">
                {user?.username?.slice(0, 2).toUpperCase() || "AD"}
              </AvatarFallback>
            </Avatar>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground truncate">
                  {user?.fullName || user?.username || "Admin User"}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {user?.role || "System Operator"}
                </p>
              </div>
            )}
            {sidebarOpen && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 text-muted-foreground hover:text-destructive transition-colors"
                onClick={logout}
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Header HUD */}
        <header className="h-16 border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-30 flex items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon" 
              className="lg:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              className="hidden lg:flex text-muted-foreground hover:text-primary"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
            
            {/* Breadcrumb / Page Title */}
            <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
              <span className="text-primary/50">SYSTEM</span>
              <span>/</span>
              <span className="text-foreground font-medium tracking-wider uppercase">
                {navItems.find(i => i.path === location)?.label || "Dashboard"}
              </span>
            </div>
          </div>

          {/* Top Right Status Indicators */}
          <div className="flex items-center gap-6">
            <div className="hidden md:flex items-center gap-4 text-xs font-mono">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_#22c55e]" />
                <span className="text-green-500">SYSTEM ONLINE</span>
              </div>
              <div className="h-4 w-px bg-border" />
              <div className="text-muted-foreground">
                LATENCY: <span className="text-primary">24ms</span>
              </div>
            </div>
            
            <Button variant="outline" size="sm" className="border-primary/30 text-primary hover:bg-primary/10 hover:text-primary hidden sm:flex">
              <Activity className="w-4 h-4 mr-2" />
              LIVE VIEW
            </Button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 relative">
          {/* Grid Background Effect */}
          <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
          
          <div className="relative z-10 max-w-[1600px] mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
