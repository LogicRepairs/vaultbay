import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Modal } from '../components/Modal'
import { api } from '../lib/api'
import { formatRelative } from '../lib/format'
import type { ShareUser } from '../shared/types'

export function UsersPage({
  users,
  onRefresh,
  onToast
}: {
  users: ShareUser[]
  onRefresh: () => Promise<void>
  onToast: (title: string, detail?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    username: '',
    displayName: '',
    password: '',
    role: 'readwrite' as ShareUser['role']
  })

  async function create() {
    try {
      await api().createUser(form)
      await onRefresh()
      setOpen(false)
      onToast('User created', form.username)
    } catch (e) {
      onToast('Could not create user', e instanceof Error ? e.message : 'Error')
    }
  }

  async function remove(id: string) {
    const result = await api().deleteUser(id)
    await onRefresh()
    onToast(result.message)
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button className="btn" onClick={() => setOpen(true)}>
          <Plus size={16} /> Add user
        </button>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Access accounts</h2>
          <span>Password-protected identities for share mapping</span>
        </div>
        <div className="panel-body">
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Last seen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{user.displayName}</strong>
                    <div className="meta">{user.username}</div>
                  </td>
                  <td>
                    <span className="chip">{user.role}</span>
                  </td>
                  <td>{formatRelative(user.lastSeenAt || user.createdAt)}</td>
                  <td>
                    {user.username !== 'admin' && (
                      <button className="btn ghost" onClick={() => remove(user.id)}>
                        <Trash2 size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {open && (
        <Modal
          title="Create share user"
          hint="These credentials are used when mapping VaultBay shares from customer devices."
          onClose={() => setOpen(false)}
          actions={
            <>
              <button className="btn secondary" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                className="btn"
                disabled={form.username.length < 3 || form.password.length < 8}
                onClick={create}
              >
                Create
              </button>
            </>
          }
        >
          <div className="form-grid two">
            <label className="field">
              Username
              <input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="techdesk"
              />
            </label>
            <label className="field">
              Display name
              <input
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                placeholder="Bench Tech"
              />
            </label>
            <label className="field">
              Password
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </label>
            <label className="field">
              Role
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as ShareUser['role'] })}
              >
                <option value="admin">Admin</option>
                <option value="readwrite">Read / Write</option>
                <option value="readonly">Read only</option>
              </select>
            </label>
          </div>
        </Modal>
      )}
    </>
  )
}
