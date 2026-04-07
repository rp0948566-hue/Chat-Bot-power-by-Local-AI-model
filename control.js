// ─── Computer Control Utility Module ──────────────────────────────────────
// Provides helper functions for dangerous action confirmation dialogs.

window.computerControl = {
    // Confirm a dangerous action (used as fallback)
    confirmDangerous(actionName) {
        return new Promise((resolve) => {
            const modal = document.getElementById('custom-modal-overlay');
            const title = document.getElementById('modal-title');
            const text = document.getElementById('modal-text');
            const cancelBtn = document.getElementById('modal-cancel-btn');
            const confirmBtn = document.getElementById('modal-confirm-btn');

            if (title) title.textContent = 'Confirm Action';
            if (text) text.textContent = `Are you sure you want to: ${actionName}?`;
            if (confirmBtn) confirmBtn.textContent = 'Yes, Do It';
            if (modal) modal.classList.add('active');

            const cleanup = (result) => {
                if (modal) modal.classList.remove('active');
                if (cancelBtn) cancelBtn.onclick = null;
                if (confirmBtn) confirmBtn.onclick = null;
                resolve(result);
            };

            if (cancelBtn) cancelBtn.onclick = (e) => { e.stopPropagation(); cleanup(false); };
            if (confirmBtn) confirmBtn.onclick = (e) => { e.stopPropagation(); cleanup(true); };
            if (modal) modal.onclick = (e) => { if (e.target === modal) cleanup(false); };
        });
    }
};
