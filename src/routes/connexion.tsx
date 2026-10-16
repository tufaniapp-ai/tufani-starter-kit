import { Link, createFileRoute } from "@tanstack/react-router";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { CODE_TTL_MINUTES } from "@/domain/login-code";
import { formatLocalPhone, normalizeMaliPhone } from "@/domain/phone";
import { supabase } from "@/integrations/supabase/client";
import { requestLoginCode, verifyLoginCode } from "@/lib/login.functions";

export const Route = createFileRoute("/connexion")({
  head: () => ({
    meta: [
      { title: "Connexion — Tufani" },
      {
        name: "description",
        content: "Connectez-vous avec votre numéro de téléphone et un code reçu par SMS.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Connexion,
});

const ERRORS: Record<string, string> = {
  numero_invalide: "Ce numéro n'est pas un numéro malien valide (8 chiffres).",
  trop_de_demandes_heure: "Trop de codes demandés. Réessayez dans une heure.",
  trop_de_demandes_jour: "Trop de codes demandés aujourd'hui. Réessayez demain.",
  envoi_impossible: "Le code n'a pas pu être envoyé. Réessayez dans un instant.",
  code_invalide: "Ce code n'est pas le bon. Vérifiez le SMS et réessayez.",
  code_expire: `Ce code a expiré (${CODE_TTL_MINUTES} min). Demandez-en un nouveau.`,
  trop_d_essais: "Trop d'essais. Demandez un nouveau code.",
  connexion_impossible: "La connexion n'a pas abouti. Réessayez dans un instant.",
};

type Step = "phone" | "code" | "done";

function Connexion() {
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isTest, setIsTest] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [account, setAccount] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setAccount(data.user.phone ? `+${data.user.phone}` : null);
        setStep("done");
      }
    });
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    const normalized = normalizeMaliPhone(phone);
    if (!normalized) {
      setError(ERRORS["numero_invalide"] ?? null);
      return;
    }
    setBusy(true);
    try {
      const res = await requestLoginCode({ data: { phone: normalized } });
      if (!res.ok) {
        setError(ERRORS[res.error] ?? ERRORS["envoi_impossible"] ?? null);
        return;
      }
      setPhone(res.phone);
      setIsTest(res.test);
      setCode("");
      setResendIn(45);
      setStep("code");
    } catch {
      setError(ERRORS["envoi_impossible"] ?? null);
    } finally {
      setBusy(false);
    }
  }

  async function checkCode(value: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await verifyLoginCode({ data: { phone, code: value } });
      if (!res.ok) {
        setError(ERRORS[res.error] ?? null);
        setCode("");
        return;
      }
      const { error: sessionError } = await supabase.auth.verifyOtp({
        token_hash: res.tokenHash,
        type: "email",
      });
      if (sessionError) {
        setError(ERRORS["connexion_impossible"] ?? null);
        return;
      }
      await supabase.rpc("claim_invitations" as never);
      setAccount(phone);
      setStep("done");
    } catch {
      setError(ERRORS["connexion_impossible"] ?? null);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setAccount(null);
    setPhone("");
    setCode("");
    setStep("phone");
  }

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center gap-3 px-5 py-5 sm:px-10">
        <Link to="/" className="flex items-center gap-3 text-foreground no-underline">
          <span
            aria-hidden="true"
            className="flex size-10 items-center justify-center rounded-xl bg-primary text-xl font-extrabold text-highlight"
          >
            T
          </span>
          <span className="text-xl font-extrabold tracking-tight">Tufani</span>
        </Link>
      </header>

      <section className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-5 pt-6 pb-16">
        {step === "phone" && (
          <form onSubmit={sendCode} className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-3xl font-extrabold tracking-tight">Connexion</h1>
              <p className="leading-relaxed text-muted-foreground">
                Entrez votre numéro. Nous envoyons un code par SMS. Pas de mot de passe.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="phone" className="text-sm font-semibold text-muted-foreground">
                Numéro de téléphone
              </label>
              <div className="flex gap-2">
                <span className="flex h-14 items-center rounded-2xl bg-secondary px-4 text-lg font-bold">
                  +223
                </span>
                <input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder="76 12 34 21"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-14 min-w-0 flex-1 rounded-2xl border-2 border-input bg-card px-4 text-lg font-bold outline-none focus:border-primary"
                />
              </div>
            </div>
            {error && (
              <p
                role="alert"
                className="rounded-xl bg-warning px-4 py-3 text-sm font-semibold text-warning-foreground"
              >
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={busy}
              className="h-14 rounded-2xl text-base font-extrabold"
            >
              {busy ? "Envoi…" : "Recevoir le code"}
            </Button>
          </form>
        )}

        {step === "code" && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-3xl font-extrabold tracking-tight">Code envoyé</h1>
              <p className="leading-relaxed text-muted-foreground">
                Tapez les 6 chiffres reçus par SMS au{" "}
                <strong className="text-foreground">{formatLocalPhone(phone)}</strong>.
              </p>
              {isTest && (
                <p className="rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground">
                  Numéro de test : aucun SMS n'est envoyé, le code est 123456.
                </p>
              )}
            </div>
            <InputOTP
              maxLength={6}
              pattern={REGEXP_ONLY_DIGITS}
              value={code}
              onChange={setCode}
              onComplete={(v: string) => void checkCode(v)}
              disabled={busy}
              autoFocus
              aria-label="Code à 6 chiffres"
            >
              <InputOTPGroup className="gap-2">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <InputOTPSlot
                    key={i}
                    index={i}
                    className="h-14 w-12 rounded-2xl border-2 bg-card text-2xl font-extrabold first:rounded-2xl last:rounded-2xl"
                  />
                ))}
              </InputOTPGroup>
            </InputOTP>
            {error && (
              <p
                role="alert"
                className="rounded-xl bg-warning px-4 py-3 text-sm font-semibold text-warning-foreground"
              >
                {error}
              </p>
            )}
            <div className="flex items-center justify-between text-sm">
              {resendIn > 0 ? (
                <span className="text-muted-foreground">
                  Renvoyer dans 0:{String(resendIn).padStart(2, "0")}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void sendCode()}
                  className="py-3 font-bold text-primary"
                >
                  Renvoyer le code
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setStep("phone");
                  setError(null);
                }}
                className="py-3 font-bold text-primary"
              >
                Changer de numéro
              </button>
            </div>
            <p className="rounded-xl bg-secondary px-4 py-3 text-sm leading-relaxed text-muted-foreground">
              Tufani ne vous demandera jamais ce code par téléphone ni par WhatsApp.
            </p>
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-col gap-6">
            <h1 className="text-3xl font-extrabold tracking-tight">Vous êtes connecté</h1>
            <p className="leading-relaxed text-muted-foreground">
              {account ? (
                <>
                  Compte : <strong className="text-foreground">{formatLocalPhone(account)}</strong>
                </>
              ) : (
                "Votre session est ouverte."
              )}
            </p>
            <Button asChild className="h-14 rounded-2xl text-base font-extrabold">
              <Link to="/">Retour à l'accueil</Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => void signOut()}
              className="h-12 rounded-2xl font-bold"
            >
              Se déconnecter
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}
