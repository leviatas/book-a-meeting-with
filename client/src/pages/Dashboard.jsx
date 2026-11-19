import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmDialog';

// Pantalla de ejemplo sobre la entidad Item: alta, lista y borrado con
// confirmación. Sirve de molde y se borra cuando estén las pantallas reales.
export default function Dashboard() {
  const { token, activeMembership } = useAuth();
  const confirm = useConfirm();
  const [items, setItems] = useState([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  const canWrite = activeMembership.role !== 'READER';

  const load = useCallback(() => {
    api.items
      .list(token)
      .then((res) => setItems(res.items))
      .catch((err) => setError(err.message));
  }, [token]);

  useEffect(load, [load]);

  async function create(e) {
    e.preventDefault();
    setError('');
    try {
      await api.items.create(token, { title: title.trim() });
      setTitle('');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(item) {
    // Toda acción destructiva pasa por useConfirm, nunca por window.confirm.
    const ok = await confirm({
      title: 'Eliminar',
      message: `¿Eliminar "${item.title}"? No se puede deshacer.`,
    });
    if (!ok) return;

    try {
      await api.items.remove(token, item.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>{activeMembership.companyName}</h1>
      </div>

      {canWrite && (
        <form className="row" onSubmit={create}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Nuevo item"
            required
          />
          <button type="submit" disabled={!title.trim()}>
            Agregar
          </button>
        </form>
      )}

      {error && <p className="error-text">{error}</p>}

      {items.length === 0 ? (
        <p className="muted">Todavía no hay nada cargado.</p>
      ) : (
        <ul className="list">
          {items.map((item) => (
            <li key={item.id} className="list-row static">
              <span>{item.title}</span>
              {canWrite && (
                <button type="button" className="btn-danger" onClick={() => remove(item)}>
                  Eliminar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
