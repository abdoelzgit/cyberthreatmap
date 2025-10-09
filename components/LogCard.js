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

      const time = new Date().toLocaleTimeString();

      const newLogs = e.targets.map((t, i) => {
        const src = e.source.id || "Unknown Source";
        const tgt = t.id || "Unknown Target";
        const type = e.attackType || "Unknown Type";
        const level = e.threatLevel || "N/A";

        // status detail
        let status = "🟢 Reached target";
        if (t.blocked) status = "🔴 Blocked";
        if (t.deflectPoint) status = "🌀 Deflected";

        // lokasi tambahan (opsional)
        const coordInfo = t.lng
          ? `(${t.lat?.toFixed(2)}, ${t.lng?.toFixed(2)})`
          : "";

        return `[${time}] ${src} → ${tgt} ${coordInfo}
Type: ${type} | Level: ${level} | Status: ${status}`;
      });

      // prepend log baru ke atas, batasi 50 baris
      setLogs((prev) => [...newLogs, ...prev].slice(0, 50));
    });

    socket.on("server-status", (msg) => {
      const time = new Date().toLocaleTimeString();
      setLogs((prev) => [
        ...prev,
      ].slice(0, 50));
    });

    return () => socket.disconnect();
  }, []);

  return (
    <Card className="w-[460px] h-[340px] bg-black/40 text-green-400 font-mono text-xs border border-green-800/40 backdrop-blur-sm">
      <CardHeader className="pb-2 border-b border-green-700/40">
        <CardTitle className="text-green-300 text-sm ">
          🛡 Threat Activity Logs
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[220px] px-4 py-0">
          {logs.length === 0 ? (
            <div className="text-green-700 italic">Waiting for threats...</div>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="mb-2 text-green-400 ">
                {log}
              </div>
            ))
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
