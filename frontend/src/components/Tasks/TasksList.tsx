import { useEffect, useState, useCallback } from 'react';
import { tasks as tasksApi } from '../../services/api';
import { socketService } from '../../services/socket';
import type { Task } from '../../types';
import './TasksList.css';

export function TasksList() {
  const [tasksList, setTasksList] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [filter, setFilter] = useState<string>('active');

  const loadTasks = useCallback(async () => {
    try {
      const params: Record<string, string | boolean> = {};
      if (filter === 'active') {
        // No status filter — show todo + in_progress
      } else if (filter !== 'all') {
        params.status = filter;
      }
      const { tasks } = await tasksApi.list(params);
      const filtered = filter === 'active'
        ? tasks.filter(t => t.status === 'todo' || t.status === 'in_progress')
        : tasks;
      setTasksList(filtered);
    } catch (err) {
      console.error('Load tasks error:', err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadTasks();
    socketService.subscribeTasks();

    const unsub1 = socketService.on('task:created', () => loadTasks());
    const unsub2 = socketService.on('task:updated', () => loadTasks());
    const unsub3 = socketService.on('task:deleted', () => loadTasks());
    const unsub4 = socketService.on('internal:connected', () => socketService.subscribeTasks());

    return () => {
      unsub1(); unsub2(); unsub3(); unsub4();
      socketService.unsubscribeTasks();
    };
  }, [loadTasks]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    await tasksApi.create({ title: newTitle.trim() });
    setNewTitle('');
    setShowCreate(false);
  };

  const handleToggleStatus = async (task: Task) => {
    const nextStatus = task.status === 'done' ? 'todo' : 'done';
    await tasksApi.update(task._id, { status: nextStatus });
  };

  const handleToggleUrgent = async (task: Task) => {
    await tasksApi.update(task._id, { urgent: !task.urgent });
  };

  const handleToggleImportant = async (task: Task) => {
    await tasksApi.update(task._id, { important: !task.important });
  };

  const handleDelete = async (id: string) => {
    await tasksApi.delete(id);
  };

  if (loading) return <div className="tasks-loading">Chargement...</div>;

  return (
    <div className="tasks-list">
      <div className="tasks-header">
        <h2>Tâches</h2>
        <div className="tasks-controls">
          <select value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="active">En cours</option>
            <option value="all">Toutes</option>
            <option value="todo">À faire</option>
            <option value="done">Terminées</option>
          </select>
          <button className="btn-primary" onClick={() => setShowCreate(!showCreate)}>
            + Nouvelle
          </button>
        </div>
      </div>

      {showCreate && (
        <form className="create-form" onSubmit={handleCreate}>
          <input
            type="text"
            placeholder="Titre de la tâche"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            autoFocus
          />
          <button type="submit">Créer</button>
          <button type="button" onClick={() => setShowCreate(false)}>Annuler</button>
        </form>
      )}

      {tasksList.length === 0 ? (
        <p className="empty">Aucune tâche.</p>
      ) : (
        <ul className="tasks-items">
          {tasksList.map(task => (
            <li key={task._id} className={`task-item ${task.status}`}>
              <button
                className={`check-btn ${task.status === 'done' ? 'checked' : ''}`}
                onClick={() => handleToggleStatus(task)}
              >
                {task.status === 'done' ? '✓' : '○'}
              </button>
              <div className="task-content">
                <span className={`task-title ${task.status === 'done' ? 'done' : ''}`}>
                  {task.title}
                </span>
                <div className="task-tags">
                  <button
                    className={`tag-btn ${task.urgent ? 'urgent active' : ''}`}
                    onClick={() => handleToggleUrgent(task)}
                  >
                    U
                  </button>
                  <button
                    className={`tag-btn ${task.important ? 'important active' : ''}`}
                    onClick={() => handleToggleImportant(task)}
                  >
                    I
                  </button>
                  {task.deadline && (
                    <span className="deadline">
                      {new Date(task.deadline).toLocaleDateString('fr-FR')}
                    </span>
                  )}
                </div>
              </div>
              <button className="delete-btn" onClick={() => handleDelete(task._id)}>×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
