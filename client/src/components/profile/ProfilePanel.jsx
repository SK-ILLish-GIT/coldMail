import { useState } from "react";
import toast from "react-hot-toast";

import { useAuth } from "../../context/authContext.jsx";

export default function ProfilePanel({ onClose }) {
  const { user, updateProfile, changePassword, logout } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [savingName, setSavingName] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [changingPw, setChangingPw] = useState(false);

  const handleSaveName = async (e) => {
    e.preventDefault();
    if (savingName || !name.trim()) return;
    setSavingName(true);
    try {
      await updateProfile({ name: name.trim() });
      toast.success("Profile updated.");
    } catch (err) {
      toast.error(err?.message || "Could not update profile.");
    } finally {
      setSavingName(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (changingPw) return;
    setChangingPw(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      toast.success("Password changed. Other sessions were signed out.");
    } catch (err) {
      toast.error(err?.message || "Could not change password.");
    } finally {
      setChangingPw(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    onClose?.();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ui-fg">Your profile</h2>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost btn-xs"
            aria-label="Close"
          >
            Close
          </button>
        </div>

        <div className="mb-5 rounded-xl border border-ui-border/80 bg-ui-panel-muted/60 px-3.5 py-3">
          <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-ui-fg-muted">
            Signed in as
          </p>
          <p className="mt-0.5 text-sm font-medium text-ui-fg">{user?.email}</p>
        </div>

        <form onSubmit={handleSaveName} className="space-y-3">
          <div>
            <label className="label" htmlFor="profile-name">
              Display name
            </label>
            <input
              id="profile-name"
              className="input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            className="btn-secondary btn-sm"
            disabled={savingName || name.trim() === (user?.name || "")}
          >
            {savingName ? "Saving…" : "Save name"}
          </button>
        </form>

        <div className="divider my-5" />

        <form onSubmit={handleChangePassword} className="space-y-3">
          <p className="text-sm font-semibold text-ui-fg">Change password</p>
          <div>
            <label className="label" htmlFor="profile-current-pw">
              Current password
            </label>
            <input
              id="profile-current-pw"
              className="input"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="profile-new-pw">
              New password
            </label>
            <input
              id="profile-new-pw"
              className="input"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <p className="help mt-1">At least 8 characters.</p>
          </div>
          <button type="submit" className="btn-secondary btn-sm" disabled={changingPw}>
            {changingPw ? "Updating…" : "Update password"}
          </button>
        </form>

        <div className="divider my-5" />

        <button type="button" onClick={handleLogout} className="btn-danger w-full">
          Sign out
        </button>
      </div>
    </div>
  );
}
