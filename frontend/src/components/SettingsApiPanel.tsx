import { useEffect, useState } from "react";
import {
  X,
  KeyRound,
  UserCircle2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../api";

type Props = {
  onClose: () => void;
  onChanged?: (data: {
    name?: string;
    avatar?: string;
    hasKeys?: boolean;
  }) => void;
};

export default function SettingsApiPanel({ onClose, onChanged }: Props) {
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [hasKeys, setHasKeys] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.getApiSettings();
        const aster = data.aster || {};
        setName(aster.name || "");
        setAvatar(aster.avatar || "");
        setHasKeys(!!aster.hasKeys);
        if (onChanged) {
          onChanged({
            name: aster.name,
            avatar: aster.avatar,
            hasKeys: !!aster.hasKeys,
          });
        }
      } catch (e: any) {
        console.error("Failed to load API settings:", e);
        toast.error(e?.message || "Nie udało się pobrać ustawień API");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    try {
      setSaving(true);
      const payload: {
        name?: string;
        avatar?: string;
        apiKey?: string;
        apiSecret?: string;
      } = {};

      if (name.trim()) payload.name = name.trim();
      if (avatar.trim()) payload.avatar = avatar.trim();
      if (apiKey.trim()) payload.apiKey = apiKey.trim();
      if (apiSecret.trim()) payload.apiSecret = apiSecret.trim();

      const res = await api.saveAsterApiSettings(payload);
      const aster = res.aster || {};
      const newName = aster.name || name;
      const newAvatar = aster.avatar || avatar;
      const newHasKeys = !!aster.hasKeys;

      setHasKeys(newHasKeys);
      setName(newName);
      setAvatar(newAvatar);
      setApiKey("");
      setApiSecret("");
      if (onChanged) {
        onChanged({
          name: newName,
          avatar: newAvatar,
          hasKeys: newHasKeys,
        });
      }
      toast.success("Ustawienia API zapisane");
    } catch (e: any) {
      console.error("Failed to save API settings:", e);
      toast.error(e?.message || "Nie udało się zapisać ustawień API");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-grid-card rounded-2xl border border-grid-border shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-grid-border/60">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-9 h-9 rounded-full bg-black/40 border border-grid-border flex items-center justify-center overflow-hidden">
                {avatar &&
                (avatar.startsWith("http") || avatar.startsWith("data:")) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatar}
                    alt="avatar"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <UserCircle2 className="w-5 h-5 text-gray-500" />
                )}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-semibold text-gray-100">
                  Ustawienia API – AsterDex
                </h2>
              </div>
              <p className="text-xs text-gray-500">
                Klucze trzymane zaszyfrowane po stronie serwera
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {loading ? (
            <div className="text-sm text-gray-500 py-4">
              Ładowanie ustawień...
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    Nazwa konta
                  </label>
                  <div className="flex items-center gap-2">
                    <UserCircle2 className="w-4 h-4 text-gray-500" />
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="flex-1 bg-black/20 border border-grid-border rounded-lg px-2.5 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-emerald-500"
                      placeholder="np. Główne konto Aster"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    Avatar (URL, tekst lub upload)
                  </label>
                  <div className="space-y-1.5">
                    <input
                      type="text"
                      value={avatar}
                      onChange={(e) => setAvatar(e.target.value)}
                      className="w-full bg-black/20 border border-grid-border rounded-lg px-2.5 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-emerald-500"
                      placeholder="opcjonalnie: URL lub opis"
                    />
                    <input
                      type="file"
                      accept="image/*"
                      className="block w-full text-xs text-gray-400 file:mr-2 file:px-2 file:py-1.5 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-emerald-500/20 file:text-emerald-300 hover:file:bg-emerald-500/30"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                          if (typeof reader.result === "string") {
                            setAvatar(reader.result);
                          }
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-blue-500/40 bg-blue-500/5 px-3 py-2.5 text-xs text-blue-200">
                <button
                  type="button"
                  onClick={() => setShowInstructions(!showInstructions)}
                  className="w-full flex items-center justify-between font-semibold mb-1 hover:text-blue-100 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <KeyRound className="w-3.5 h-3.5" />
                    Jak uzyskać klucze API z AsterDex?
                  </span>
                  {showInstructions ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
                {showInstructions && (
                  <div className="mt-2 space-y-2 text-blue-200/90">
                    <ol className="list-decimal list-inside space-y-1.5 ml-1">
                      <li>
                        Zaloguj się na{" "}
                        <a
                          href="https://www.asterdex.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-300 hover:text-blue-200 underline inline-flex items-center gap-1"
                        >
                          AsterDex
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </li>
                      <li>
                        Przejdź do sekcji{" "}
                        <span className="font-semibold">API Management</span>{" "}
                        (lub{" "}
                        <span className="font-semibold">Ustawienia API</span>)
                      </li>
                      <li>
                        Kliknij{" "}
                        <span className="font-semibold">
                          "Utwórz nowy klucz API"
                        </span>{" "}
                        lub{" "}
                        <span className="font-semibold">"Create API Key"</span>
                      </li>
                      <li>
                        Nadaj kluczowi nazwę (np.{" "}
                        <span className="font-semibold">"GridBot Trading"</span>
                        )
                      </li>
                      <li>
                        <span className="font-semibold">Ważne:</span> Ustaw
                        uprawnienia:
                        <ul className="list-disc list-inside ml-4 mt-1 space-y-0.5">
                          <li>
                            <span className="font-semibold">TRADE</span> -
                            wymagane do składania zleceń
                          </li>
                          <li>
                            <span className="font-semibold">READ</span> -
                            opcjonalne, do odczytu sald
                          </li>
                        </ul>
                      </li>
                      <li>
                        <span className="font-semibold">Bezpieczeństwo:</span>{" "}
                        Ustaw{" "}
                        <span className="font-semibold">IP whitelist</span>{" "}
                        jeśli to możliwe (dodaj IP serwera Railway lub zostaw
                        puste dla testów)
                      </li>
                      <li>
                        Po utworzeniu skopiuj{" "}
                        <span className="font-semibold">API Key</span> i{" "}
                        <span className="font-semibold">Secret Key</span>
                      </li>
                      <li className="text-amber-300 font-semibold">
                        ⚠️ Secret Key jest wyświetlany tylko raz! Zapisz go
                        bezpiecznie.
                      </li>
                    </ol>
                    <div className="mt-2 pt-2 border-t border-blue-500/30">
                      <p className="text-xs text-blue-300/80">
                        Jeśli nie możesz znaleźć sekcji API, sprawdź{" "}
                        <a
                          href="https://www.asterdex.com/en/api-management"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-blue-200 inline-flex items-center gap-1"
                        >
                          dokumentację AsterDex
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                <div className="font-semibold mb-1">Bezpieczeństwo</div>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>
                    Klucze API są{" "}
                    <span className="font-semibold">
                      szyfrowane na serwerze
                    </span>{" "}
                    przy użyciu stałego klucza z `.env`.
                  </li>
                  <li>
                    Po zapisaniu{" "}
                    <span className="font-semibold">
                      nie są już nigdzie wyświetlane
                    </span>{" "}
                    w panelu.
                  </li>
                </ul>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-gray-400">
                  API Key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full bg-black/20 border border-grid-border rounded-lg px-2.5 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-emerald-500"
                  placeholder={hasKeys ? "******** (zapisane – nadpisz)" : ""}
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-gray-400">
                  API Secret
                </label>
                <input
                  type="password"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  className="w-full bg-black/20 border border-grid-border rounded-lg px-2.5 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-emerald-500"
                  placeholder={hasKeys ? "******** (zapisane – nadpisz)" : ""}
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="text-xs text-gray-500">
                  Status kluczy:{" "}
                  <span
                    className={
                      hasKeys
                        ? "text-emerald-400 font-semibold"
                        : "text-red-400"
                    }
                  >
                    {hasKeys ? "Zapisane" : "Brak"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-3 py-1.5 rounded-lg border border-grid-border text-xs text-gray-300 hover:bg-white/5 transition-colors"
                  >
                    Zamknij
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-xs font-semibold text-white disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  >
                    {saving ? "Zapisywanie..." : "Zapisz"}
                  </button>
                </div>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
