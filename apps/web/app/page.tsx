"use client";

import { Suspense, type ReactNode } from "react";
import { FiduciaryChat } from "./components/FiduciaryChat";
import { AppShellHeader } from "./components/AppShellHeader";

function ChatAppShell({ children }: { children: ReactNode }) {
  return (
    <div className="lpft-app-shell lpft-app-shell--screen">
      <AppShellHeader activePath="/" />
      {children}
    </div>
  );
}

function ChatLoadingShell() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="lpft-main lpft-main-chat-full min-h-0 flex-1">
        <div className="lpft-card lpft-card--chat-full flex min-h-0 flex-1 flex-col overflow-hidden opacity-60" />
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <ChatAppShell>
      <Suspense fallback={<ChatLoadingShell />}>
        <FiduciaryChat />
      </Suspense>
    </ChatAppShell>
  );
}
