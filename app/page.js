'use client'
import { Button } from "@/components/ui/button";
import dynamic from "next/dynamic";


const CyberMap = dynamic(() => import("../components/CyberMap"), { ssr: false });

export default function Home() {
  return (
    <div style={{ height: "100vh", width: "100%" }}>
      <CyberMap />
    </div>
  );
}
