"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type TopBarProps = {
  orgName: string | null;
  userEmail: string | null;
  role: string | null;
};

export function TopBar({ orgName, userEmail, role }: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const handleSignOut = async () => {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const initial = (userEmail ?? "?").charAt(0).toUpperCase();

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-line bg-ink px-6">
      <div>
        <p className="text-sm font-semibold text-paper">
          {orgName ?? "No organization"}
        </p>
        {role && (
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
            {role}
          </p>
        )}
      </div>

      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex items-center gap-2 rounded-full border border-line py-1 pl-1 pr-3 text-sm text-paper transition-colors hover:border-signal"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-signal font-mono text-xs font-semibold text-white">
            {initial}
          </span>
          <span className="max-w-[10rem] truncate">{userEmail ?? "Account"}</span>
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 mt-2 w-48 overflow-hidden rounded-md border border-line bg-panel shadow-2xl shadow-black/40"
          >
            <div className="border-b border-line px-4 py-3">
              <p className="truncate text-xs text-mute">{userEmail}</p>
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={handleSignOut}
              disabled={signingOut}
              className="flex w-full items-center px-4 py-2.5 text-left text-sm text-paper transition-colors hover:bg-line/40 disabled:opacity-60"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
