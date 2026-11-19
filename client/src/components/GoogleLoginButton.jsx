import { useEffect, useRef } from 'react';

// Google Identity Services se carga como <script> en runtime, NO como paquete
// de npm. Google sólo valida el ORIGEN (no hay redirect URI), así que cada
// origen desde el que se sirva el cliente tiene que estar en "Authorized
// JavaScript origins" del Client ID.
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export default function GoogleLoginButton({ onCredential }) {
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!CLIENT_ID) return;

    function render() {
      if (!window.google || !buttonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: (response) => onCredential(response.credential),
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        shape: 'pill',
      });
    }

    if (window.google) {
      render();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = render;
    document.body.appendChild(script);

    return () => {
      script.onload = null;
    };
  }, [onCredential]);

  if (!CLIENT_ID) {
    return <p className="error-text">Falta configurar VITE_GOOGLE_CLIENT_ID en client/.env</p>;
  }

  return <div ref={buttonRef} />;
}
