import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import './AuthScreen.css';

export function AuthScreen() {
  const { login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isRegister) {
        await register(username, displayName, email, password);
      } else {
        await login(username, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1>Panoramix</h1>
        <p className="auth-subtitle">
          {isRegister ? 'Créer un compte' : 'Connexion'}
        </p>

        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Nom d'utilisateur"
            value={username}
            onChange={e => setUsername(e.target.value)}
            required
            autoFocus
          />

          {isRegister && (
            <>
              <input
                type="text"
                placeholder="Nom affiché"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                required
              />
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </>
          )}

          <input
            type="password"
            placeholder="Mot de passe"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" disabled={loading}>
            {loading ? '...' : isRegister ? "S'inscrire" : 'Se connecter'}
          </button>
        </form>

        <button
          className="auth-toggle"
          onClick={() => { setIsRegister(!isRegister); setError(''); }}
        >
          {isRegister ? 'Déjà un compte ? Se connecter' : 'Pas de compte ? Créer'}
        </button>
      </div>
    </div>
  );
}
