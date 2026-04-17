import { useUI } from '../../state/uiState';

export default function Toast() {
  const { toast } = useUI();
  if (!toast) return null;

  return (
    <div className={`toast toast-${toast.type} show`}>
      {toast.msg}
    </div>
  );
}
