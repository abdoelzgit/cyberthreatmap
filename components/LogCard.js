"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import io from "socket.io-client";

export default function ThreatLogCard() {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    const socket = io("http://localhost:4000");

    socket.on("attack-event", (e) => {
      if (!e || !e.source || !Array.isArray(e.targets)) return;

      const newLogs = e.targets.map((t) => {
        const threatLevel = e.threatLevel || "Unknown";
        const attackType = e.attackType || "Unknown";

        // blokir / pantulan info
        const blocked = t.blocked ? "🔒 Blocked" : "✅ Passed";
        const deflect = t.deflectPoint ? " (Deflect)" : "";

        return `[${new Date().toLocaleTimeString()}] ${e.source.id} → ${t.id} - ${attackType} - ${threatLevel} - ${blocked}${deflect}`;
      });

      setLogs((prev) => [...newLogs, ...prev].slice(0, 50));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return (
    <Card className="w-[420px] h-[320px] bg-black/10 text-green-400 font-mono text-sm">
      <CardHeader className="pb-2 border-b border-green-700">
        <CardTitle className="text-green-300 text-base">🛡 Threat Logs</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[200px] px-4 py-0">
          {logs.length === 0 && (
            <div className="text-green-600">No threats yet...</div>
          )}
          {logs.map((log, i) => (
            <div key={i} className="whitespace-pre-wrap">
              {log}
            </div>
          ))}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
