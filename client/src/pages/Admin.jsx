import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmDialog';

const ROLE_LABELS = {
  ADMIN: 'Administrador',
  DIRECTOR: 'Director',
  READER: 'Solo lectura',
};

const STATUS_LABELS = {
  PENDING: 'Pendiente',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado',
};

export default function Admin() {
  const { token } = useAuth();
  const confirm = useConfirm();
  const [members, setMembers] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.admin
      .listMembers(token)
      .then((res) => setMembers(res.members))
      .catch((err) => setError(err.message));
  }, [token]);

  useEffect(load, [load]);

  async function update(member, data) {
    setError('');
    try {
      await api.admin.updateMember(token, member.id, data);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function reject(member) {
    const ok = await confirm({
      title: 'Rechazar acceso',
      message: `¿Sacarle el acceso a ${member.name}?`,
      confirmLabel: 'Rechazar',
    });
    if (ok) update(member, { status: 'REJECTED' });
  }

  const pending = members.filter((m) => m.status === 'PENDING');
  const rest = members.filter((m) => m.status !== 'PENDING');

  return (
    <div className="page">
      <div className="page-header">
        <h1>Administración</h1>
      </div>

      {error && <p className="error-text">{error}</p>}

      <section className="section">
        <h3>Pedidos de acceso ({pending.length})</h3>
        {pending.length === 0 ? (
          <p className="muted">No hay pedidos pendientes.</p>
        ) : (
          pending.map((m) => (
            <div key={m.id} className="list-row static">
              <span>
                {m.name} <span className="muted">{m.email}</span>
              </span>
              <span className="row">
                <button type="button" onClick={() => update(m, { status: 'APPROVED' })}>
                  Aprobar
                </button>
                <button type="button" className="btn-danger" onClick={() => reject(m)}>
                  Rechazar
                </button>
              </span>
            </div>
          ))
        )}
      </section>

      <section className="section">
        <h3>Miembros</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>Estado</th>
                <th>Rol</th>
              </tr>
            </thead>
            <tbody>
              {rest.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td>{m.email}</td>
                  <td>{STATUS_LABELS[m.status]}</td>
                  <td>
                    <select value={m.role} onChange={(e) => update(m, { role: e.target.value })}>
                      {Object.entries(ROLE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
