// Marco de las páginas públicas: sin header del panel ni datos de sesión.
export default function PublicShell({ children, wide }) {
  return (
    <div className="public-shell">
      <main className={wide ? 'public-main wide' : 'public-main'}>{children}</main>
      <footer className="public-footer muted small">
        Agendado con <strong>Book a Meeting</strong> · software libre
      </footer>
    </div>
  );
}
