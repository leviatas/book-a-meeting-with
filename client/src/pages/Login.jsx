import { useCallback, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import GoogleLoginButton from '../components/GoogleLoginButton';

export default function Login() {
  const { loginWithCredential } = useAuth();
  const [error, setError] = useState('');

  const onCredential = useCallback(
    async (credential) => {
      setError('');
      try {
        await loginWithCredential(credential);
      } catch (err) {
        setError(err.message);
      }
    },
    [loginWithCredential]
  );

  return (
    <div className="centered-page">
      <div className="card login-card">
        <h1>Book a Meeting</h1>
        <p className="muted">Entrá con tu cuenta de Google para continuar.</p>
        <GoogleLoginButton onCredential={onCredential} />
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}
