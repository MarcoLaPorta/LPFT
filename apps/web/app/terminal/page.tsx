import { redirect } from "next/navigation";

/** Il terminale AFX separato è stato accorpato concettualmente alla home LPFT (`/`). */
export default function TerminalRedirectPage() {
  redirect("/");
}
