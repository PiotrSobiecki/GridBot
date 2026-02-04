import { useEffect } from 'react';
import { useStore } from './store/useStore';
import { api } from './api';
import ConnectWallet from './components/ConnectWallet';
import Dashboard from './components/Dashboard';

function App() {
  const { isAuthenticated, token, setUserSettings, logout } = useStore();

  useEffect(() => {
    if (token) {
      api.setToken(token);
      // Sprawdź sesję i pobierz ustawienia
      api.checkSession()
        .then(async (res) => {
          if (res.authenticated) {
            const settings = await api.getSettings();
            setUserSettings(settings);
          } else {
            logout();
          }
        })
        .catch(() => {
          logout();
        });
    }
  }, [token, setUserSettings, logout]);

  return (
    <div className="min-h-screen grid-pattern">
      {isAuthenticated ? <Dashboard /> : <ConnectWallet />}
    </div>
  );
}

export default App;
