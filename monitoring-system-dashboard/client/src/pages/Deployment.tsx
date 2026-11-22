import { useState } from "react";
import { 
  CheckCircle2, 
  Circle, 
  AlertCircle, 
  Rocket, 
  ShieldCheck, 
  Server, 
  Database, 
  Globe,
  ChevronRight,
  ChevronDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

// Mock Data
const checklistCategories = [
  {
    id: "infra",
    title: "Infrastructure",
    icon: Server,
    items: [
      { id: "inf-1", label: "Load Balancer Health Check", status: "completed", required: true },
      { id: "inf-2", label: "Auto-scaling Groups Configured", status: "completed", required: true },
      { id: "inf-3", label: "VPC Peering Verified", status: "pending", required: true },
      { id: "inf-4", label: "CDN Cache Purged", status: "pending", required: false },
    ]
  },
  {
    id: "db",
    title: "Database & Storage",
    icon: Database,
    items: [
      { id: "db-1", label: "Migrations Applied", status: "completed", required: true },
      { id: "db-2", label: "Backup Created", status: "completed", required: true },
      { id: "db-3", label: "Seed Data Verified", status: "completed", required: false },
    ]
  },
  {
    id: "security",
    title: "Security",
    icon: ShieldCheck,
    items: [
      { id: "sec-1", label: "SSL Certificates Valid", status: "completed", required: true },
      { id: "sec-2", label: "Firewall Rules Updated", status: "pending", required: true },
      { id: "sec-3", label: "API Keys Rotated", status: "pending", required: false },
    ]
  },
  {
    id: "app",
    title: "Application",
    icon: Globe,
    items: [
      { id: "app-1", label: "Smoke Tests Passed", status: "completed", required: true },
      { id: "app-2", label: "Environment Variables Set", status: "completed", required: true },
      { id: "app-3", label: "Feature Flags Configured", status: "pending", required: true },
    ]
  }
];

export default function Deployment() {
  const [openCategories, setOpenCategories] = useState<string[]>(["infra", "db", "security", "app"]);
  const [items, setItems] = useState(checklistCategories);

  const toggleCategory = (id: string) => {
    setOpenCategories(prev => 
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const toggleItem = (catId: string, itemId: string) => {
    setItems(prev => prev.map(cat => {
      if (cat.id !== catId) return cat;
      return {
        ...cat,
        items: cat.items.map(item => {
          if (item.id !== itemId) return item;
          return { ...item, status: item.status === 'completed' ? 'pending' : 'completed' };
        })
      };
    }));
  };

  // Calculate Stats
  const allItems = items.flatMap(c => c.items);
  const totalItems = allItems.length;
  const completedItems = allItems.filter(i => i.status === 'completed').length;
  const progress = Math.round((completedItems / totalItems) * 100);
  
  const requiredItems = allItems.filter(i => i.required);
  const completedRequired = requiredItems.filter(i => i.status === 'completed').length;
  const isReady = completedRequired === requiredItems.length;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row gap-6 justify-between items-start md:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-glow flex items-center gap-3">
            <Rocket className="w-6 h-6 text-primary" />
            Deployment Checklist
          </h1>
          <p className="text-muted-foreground mt-1">Verify system readiness before production deployment.</p>
        </div>
        
        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="flex-1 md:w-48">
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-muted-foreground">Readiness</span>
              <span className="font-mono font-bold text-primary">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
          <Button 
            size="lg" 
            disabled={!isReady}
            className={cn(
              "font-bold tracking-wide shadow-[0_0_20px_-5px_var(--color-primary)] transition-all duration-300",
              isReady ? "animate-pulse" : "opacity-50"
            )}
          >
            {isReady ? "INITIATE DEPLOY" : "NOT READY"}
          </Button>
        </div>
      </div>

      {/* Status Banner */}
      {!isReady && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <h3 className="font-medium text-amber-500">Pending Required Items</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {requiredItems.length - completedRequired} mandatory checks must be completed before deployment can proceed.
            </p>
          </div>
        </div>
      )}

      {/* Checklist Categories */}
      <div className="grid gap-4">
        {items.map((category) => {
          const isOpen = openCategories.includes(category.id);
          const catCompleted = category.items.filter(i => i.status === 'completed').length;
          const catTotal = category.items.length;
          const isComplete = catCompleted === catTotal;

          return (
            <Collapsible 
              key={category.id} 
              open={isOpen} 
              onOpenChange={() => toggleCategory(category.id)}
              className="border border-border/50 rounded-lg bg-card/50 overflow-hidden transition-all duration-200 hover:border-primary/30"
            >
              <div className="flex items-center justify-between p-4 bg-card/80">
                <div className="flex items-center gap-3">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="p-0 h-6 w-6 hover:bg-transparent">
                      {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </Button>
                  </CollapsibleTrigger>
                  <div className={`p-2 rounded-md bg-background/50 border border-border/50`}>
                    <category.icon className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">{category.title}</h3>
                    <p className="text-xs text-muted-foreground">
                      {catCompleted}/{catTotal} checks passed
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {isComplete && (
                    <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
                      PASSED
                    </Badge>
                  )}
                  <Progress value={(catCompleted / catTotal) * 100} className="w-24 h-1.5" />
                </div>
              </div>

              <CollapsibleContent>
                <div className="p-4 pt-0 space-y-1">
                  {category.items.map((item) => (
                    <div 
                      key={item.id} 
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-md transition-colors",
                        item.status === 'completed' ? "bg-primary/5" : "hover:bg-background/50"
                      )}
                    >
                      <Checkbox 
                        id={item.id} 
                        checked={item.status === 'completed'}
                        onCheckedChange={() => toggleItem(category.id, item.id)}
                        className="border-primary/50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
                      />
                      <div className="flex-1">
                        <label 
                          htmlFor={item.id}
                          className={cn(
                            "text-sm font-medium cursor-pointer select-none",
                            item.status === 'completed' ? "text-foreground" : "text-muted-foreground"
                          )}
                        >
                          {item.label}
                        </label>
                      </div>
                      {item.required && (
                        <Badge variant="secondary" className="text-[10px] h-5 px-1.5 bg-background/50 text-muted-foreground border-border/50">
                          REQUIRED
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}
