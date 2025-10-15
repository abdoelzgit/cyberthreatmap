"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import io from "socket.io-client";

export default function ThreatLogCard() {
  const [logs, setLogs] = useState([]);
  const scrollAreaRef = useRef(null);

  useEffect(() => {
    const socket = io("http://localhost:4000");

    socket.on("attack-event", (e) => {
      if (!e || !e.source || !e.target) return;

      const threatLevel = e.threatLevel || "Unknown";
      const attackType = e.attackType || "Unknown";

      const newLog = `[${new Date().toLocaleTimeString()}] ${e.source.id} → ${e.target.id} - ${attackType} - ${threatLevel}`;

      setLogs((prev) => [newLog, ...prev]);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Auto-scroll to bottom when logs change
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollElement = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }
    }
  }, [logs]);

  return (
    <Card className="w-[420px] h-[320px] bg-black/10 text-green-400 font-mono text-sm">
      <CardHeader className="pb-2 border-b border-green-700">
        <CardTitle className="text-green-300 text-base">🛡 Threat Logs</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea ref={scrollAreaRef} className="h-[200px] px-4 py-0">
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
