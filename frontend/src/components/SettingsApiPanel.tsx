import { useEffect, useState } from "react";
import {
  X,
  KeyRound,
  UserCircle2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Building2,
} from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../api";
import { useStore } from "../store/useStore";

type Props = {
  onClose: () => void;
  onChanged?: (data: {
    name?: string;
    avatar?: string;
    hasKeys?: boolean;
  }) => void;
};

type Exchange = "asterdex" | "bingx";

export default function SettingsApiPanel({ onClose }: Props) {
  const { setUserSettings } = useStore();
  const [selectedExchange, setSelectedExchange] = useState<Exchange>("asterdex");
  const [activeTab, setActiveTab] = useState<"exchange" | "api">("exchange");
  
  // AsterDex state
  const [asterName, setAsterName] = useState("");
  const [asterAvatar, setAsterAvatar] = useState("");
  const [asterApiKey, setAsterApiKey] = useState("");
  const [asterApiSecret, setAsterApiSecret] = useState("");
  const [asterHasKeys, setAsterHasKeys] = useState(false);
  
  // BingX state
  const [bingxName, setBingxName] = useState("");
  const [bingxAvatar, setBingxAvatar] = useState("");
  const [bingxApiKey, setBingxApiKey] = useState("");
  const [bingxApiSecret, setBingxApiSecret] = useState("");
  const [bingxHasKeys, setBingxHasKeys] = useState(false);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingExchange, setSavingExchange] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [apiData, settings] = await Promise.all([
          api.getApiSettings(),
          api.getSettings(),
        ]);
        
        // Load AsterDex
        const aster = apiData.aster || {};
        setAsterName(aster.name || "");
        setAsterAvatar(aster.avatar || "");
        setAsterHasKeys(!!aster.hasKeys);
        
        // Load BingX
        const bingx = apiData.bingx || {};
        setBingxName(bingx.name || "");
        setBingxAvatar(bingx.avatar || "");
        setBingxHasKeys(!!bingx.hasKeys);
        
        // Load exchange selection
        const exchange = settings.exchange || "asterdex";
        setSelectedExchange(exchange as Exchange);
        
      } catch (e: any) {
        console.error("Failed to load settings:", e);
        toast.error(e?.message || "Nie udało się pobrać ustawień");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const handleSaveExchange = async () => {
    if (savingExchange) return;
    try {
      setSavingExchange(true);
      await api.setExchange(selectedExchange);
      
      // Odśwież ustawienia użytkownika w store (zlecenia będą przefiltrowane przez backend)
      if (setUserSettings) {
        const updatedSettings = await api.getSettings();
        setUserSettings(updatedSettings);
        
        // Resetuj activeOrderIndex jeśli aktualne zlecenie nie istnieje po zmianie giełdy
        const store = useStore.getState();
        if (updatedSettings.orders && updatedSettings.orders.length > 0) {
          store.setActiveOrderIndex(0); // Przejdź do pierwszego zlecenia nowej giełdy
        } else {
          store.setActiveOrderIndex(0); // Reset jeśli brak zleceń
        }
      }
      
      toast.success(`Wybrano giełdę: ${selectedExchange === "asterdex" ? "AsterDex" : "BingX"}. Zlecenia zostały przefiltrowane.`);
      
      // Zamknij panel po zapisaniu
      setTimeout(() => {
        onClose();
      }, 500);
    } catch (e: any) {
      console.error("Failed to save exchange:", e);
      toast.error(e?.message || "Nie udało się zapisać wyboru giełdy");
    } finally {
      setSavingExchange(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    try {
      setSaving(true);
      const isAster = activeTab === "api" && selectedExchange === "asterdex";
      
      if (isAster) {
        const payload: {
          name?: string;
          avatar?: string;
          apiKey?: string;
          apiSecret?: string;
        } = {};

        if (asterName.trim()) payload.name = asterName.trim();
        if (asterAvatar.trim()) payload.avatar = asterAvatar.trim();
        if (asterApiKey.trim()) payload.apiKey = asterApiKey.trim();
        if (asterApiSecret.trim()) payload.apiSecret = asterApiSecret.trim();

        const res = await api.saveAsterApiSettings(payload);
        const aster = res.aster || {};
        setAsterHasKeys(!!aster.hasKeys);
        setAsterName(aster.name || asterName);
        setAsterAvatar(aster.avatar || asterAvatar);
        setAsterApiKey("");
        setAsterApiSecret("");
        toast.success("Ustawienia API AsterDex zapisane");
      } else {
        const payload: {
          name?: string;
          avatar?: string;
          apiKey?: string;
          apiSecret?: string;
        } = {};

        if (bingxName.trim()) payload.name = bingxName.trim();
        if (bingxAvatar.trim()) payload.avatar = bingxAvatar.trim();
        if (bingxApiKey.trim()) payload.apiKey = bingxApiKey.trim();
        if (bingxApiSecret.trim()) payload.apiSecret = bingxApiSecret.trim();

        const res = await api.saveBingXApiSettings(payload);
        const bingx = res.bingx || {};
        setBingxHasKeys(!!bingx.hasKeys);
        setBingxName(bingx.name || bingxName);
        setBingxAvatar(bingx.avatar || bingxAvatar);
        setBingxApiKey("");
        setBingxApiSecret("");
        toast.success("Ustawienia API BingX zapisane");
      }
    } catch (e: any) {
      console.error("Failed to save API settings:", e);
      toast.error(e?.message || "Nie udało się zapisać ustawień API");
    } finally {
      setSaving(false);
    }
  };

  const currentName = activeTab === "api" && selectedExchange === "asterdex" ? asterName : bingxName;
  const currentAvatar = activeTab === "api" && selectedExchange === "asterdex" ? asterAvatar : bingxAvatar;
  const currentHasKeys = activeTab === "api" && selectedExchange === "asterdex" ? asterHasKeys : bingxHasKeys;
  const currentApiKey = activeTab === "api" && selectedExchange === "asterdex" ? asterApiKey : bingxApiKey;
  const currentApiSecret = activeTab === "api" && selectedExchange === "asterdex" ? asterApiSecret : bingxApiSecret;
  const setName = activeTab === "api" && selectedExchange === "asterdex" ? setAsterName : setBingxName;
  const setAvatar = activeTab === "api" && selectedExchange === "asterdex" ? setAsterAvatar : setBingxAvatar;
  const setApiKey = activeTab === "api" && selectedExchange === "asterdex" ? setAsterApiKey : setBingxApiKey;
  const setApiSecret = activeTab === "api" && selectedExchange === "asterdex" ? setAsterApiSecret : setBingxApiSecret;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-grid-card rounded-2xl border border-grid-border shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-grid-border/60 sticky top-0 bg-grid-card">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-9 h-9 rounded-full bg-black/40 border border-grid-border flex items-center justify-center overflow-hidden">
                {currentAvatar &&
                (currentAvatar.startsWith("http") || currentAvatar.startsWith("data:")) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={currentAvatar}
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
                  Ustawienia Giełdy
                </h2>
              </div>
              <p className="text-xs text-gray-500">
                Wybór giełdy i klucze API
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

        {/* Tabs */}
        <div className="flex border-b border-grid-border/60">
          <button
            onClick={() => setActiveTab("exchange")}
            className={`flex-1 px-4 py-3 text-xs font-medium transition-colors ${
              activeTab === "exchange"
                ? "text-emerald-400 border-b-2 border-emerald-400"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            <Building2 className="w-4 h-4 inline mr-2" />
            Wybór Giełdy
          </button>
          <button
            onClick={() => setActiveTab("api")}
            className={`flex-1 px-4 py-3 text-xs font-medium transition-colors ${
              activeTab === "api"
                ? "text-emerald-400 border-b-2 border-emerald-400"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            <KeyRound className="w-4 h-4 inline mr-2" />
            Klucze API
          </button>
        </div>

        {loading ? (
          <div className="text-sm text-gray-500 py-8 text-center">
            Ładowanie ustawień...
          </div>
        ) : activeTab === "exchange" ? (
          <div className="px-5 py-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-2">
                Wybierz giełdę
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedExchange("asterdex")}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    selectedExchange === "asterdex"
                      ? "border-emerald-500 bg-emerald-500/10"
                      : "border-grid-border hover:border-emerald-500/50"
                  }`}
                >
                  <div className="text-sm font-semibold text-gray-100 mb-1">
                    AsterDex
                  </div>
                  <div className="text-xs text-gray-500">
                    Domyślna giełda
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedExchange("bingx")}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    selectedExchange === "bingx"
                      ? "border-emerald-500 bg-emerald-500/10"
                      : "border-grid-border hover:border-emerald-500/50"
                  }`}
                >
                  <div className="text-sm font-semibold text-gray-100 mb-1">
                    BingX
                  </div>
                  <div className="text-xs text-gray-500">
                    Alternatywna giełda
                  </div>
                </button>
              </div>
            </div>
            
            <div className="rounded-lg border border-blue-500/40 bg-blue-500/5 px-3 py-2.5 text-xs text-blue-200">
              <div className="font-semibold mb-1">Informacja</div>
              <p>
                Wybrana giełda będzie używana do wszystkich transakcji i pobierania cen.
                Możesz zmienić giełdę w dowolnym momencie.
              </p>
            </div>

            <button
              type="button"
              onClick={handleSaveExchange}
              disabled={savingExchange}
              className="w-full px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-xs font-semibold text-white disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {savingExchange ? "Zapisywanie..." : "Zapisz wybór"}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
            {/* Exchange selector for API tab */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-2">
                Konfiguruj klucze API dla:
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedExchange("asterdex")}
                  className={`p-3 rounded-lg border transition-all ${
                    selectedExchange === "asterdex"
                      ? "border-emerald-500 bg-emerald-500/10"
                      : "border-grid-border hover:border-emerald-500/50"
                  }`}
                >
                  <div className="text-xs font-semibold text-gray-100">AsterDex</div>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedExchange("bingx")}
                  className={`p-3 rounded-lg border transition-all ${
                    selectedExchange === "bingx"
                      ? "border-emerald-500 bg-emerald-500/10"
                      : "border-grid-border hover:border-emerald-500/50"
                  }`}
                >
                  <div className="text-xs font-semibold text-gray-100">BingX</div>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  Nazwa konta
                </label>
                <div className="flex items-center gap-2">
                  <UserCircle2 className="w-4 h-4 text-gray-500" />
                  <input
                    type="text"
                    value={currentName}
                    onChange={(e) => setName(e.target.value)}
                    className="flex-1 bg-black/20 border border-grid-border rounded-lg px-2.5 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-emerald-500"
                    placeholder={`np. Główne konto ${selectedExchange === "asterdex" ? "Aster" : "BingX"}`}
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
                    value={currentAvatar}
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
                  Jak uzyskać klucze API z {selectedExchange === "asterdex" ? "AsterDex" : "BingX"}?
                </span>
                {showInstructions ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
              {showInstructions && (
                <div className="mt-2 space-y-2 text-blue-200/90">
                  {selectedExchange === "asterdex" ? (
                    <>
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
                          <span className="font-semibold">API Management</span>
                        </li>
                        <li>
                          Kliknij{" "}
                          <span className="font-semibold">
                            "Utwórz nowy klucz API"
                          </span>
                        </li>
                        <li>
                          Nadaj kluczowi nazwę (np.{" "}
                          <span className="font-semibold">"GridBot Trading"</span>
                          )
                        </li>
                        <li>
                          <span className="font-semibold">Ważne:</span> Ustaw
                          uprawnienia: <span className="font-semibold">TRADE</span> i{" "}
                          <span className="font-semibold">READ</span>
                        </li>
                        <li>
                          Po utworzeniu skopiuj{" "}
                          <span className="font-semibold">API Key</span> i{" "}
                          <span className="font-semibold">Secret Key</span>
                        </li>
                        <li className="text-amber-300 font-semibold">
                          ⚠️ Secret Key jest wyświetlany tylko raz!
                        </li>
                      </ol>
                    </>
                  ) : (
                    <>
                      <ol className="list-decimal list-inside space-y-1.5 ml-1">
                        <li>
                          Zaloguj się na{" "}
                          <a
                            href="https://bingx.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-300 hover:text-blue-200 underline inline-flex items-center gap-1"
                          >
                            BingX
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </li>
                        <li>
                          Przejdź do{" "}
                          <span className="font-semibold">API Management</span>
                        </li>
                        <li>
                          Kliknij{" "}
                          <span className="font-semibold">
                            "Create API Key"
                          </span>
                        </li>
                        <li>
                          Nadaj kluczowi nazwę i ustaw uprawnienia:{" "}
                          <span className="font-semibold">Spot Trading</span>
                        </li>
                        <li>
                          Po utworzeniu skopiuj{" "}
                          <span className="font-semibold">API Key</span> i{" "}
                          <span className="font-semibold">Secret Key</span>
                        </li>
                        <li className="text-amber-300 font-semibold">
                          ⚠️ Secret Key jest wyświetlany tylko raz!
                        </li>
                      </ol>
                    </>
                  )}
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
                  </span>
                </li>
                <li>
                  Po zapisaniu{" "}
                  <span className="font-semibold">
                    nie są już nigdzie wyświetlane
                  </span>
                </li>
              </ul>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-gray-400">
                API Key
              </label>
              <input
                type="password"
                value={currentApiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full bg-black/20 border border-grid-border rounded-lg px-2.5 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-emerald-500"
                placeholder={currentHasKeys ? "******** (zapisane – nadpisz)" : ""}
              />
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-gray-400">
                API Secret
              </label>
              <input
                type="password"
                value={currentApiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                className="w-full bg-black/20 border border-grid-border rounded-lg px-2.5 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-emerald-500"
                placeholder={currentHasKeys ? "******** (zapisane – nadpisz)" : ""}
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="text-xs text-gray-500">
                Status kluczy:{" "}
                <span
                  className={
                    currentHasKeys
                      ? "text-emerald-400 font-semibold"
                      : "text-red-400"
                  }
                >
                  {currentHasKeys ? "Zapisane" : "Brak"}
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
          </form>
        )}
      </div>
    </div>
  );
}
