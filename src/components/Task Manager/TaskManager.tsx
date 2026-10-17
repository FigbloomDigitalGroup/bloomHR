import TaskWorkspace from '../Tasks/TaskWorkspace';

// The Task Manager page (/tasks): tasks like Linear (FIG-886, migration 20261019200000). It replaced the old
// microfinance to-do list; the old rows were copied into each company's "General" project.
export default function TaskManager() {
  return (
    <div className="p-4 md:p-6">
      <TaskWorkspace mode="admin" />
    </div>
  );
}
