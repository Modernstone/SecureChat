/**
 * SecureChat Auth Module
 * ======================
 * Handles registration (with key generation) and login form submissions.
 */

(function () {
    'use strict';

    // ---------- CSRF Token Helper ----------
    function getCsrfToken() {
        const meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.getAttribute('content') : '';
    }

    // ---------- Validation ----------
    function validateUsername(value) {
        if (!value || value.trim().length < 3) return 'Username must be at least 3 characters.';
        if (value.trim().length > 64) return 'Username must be at most 64 characters.';
        if (!/^[a-zA-Z0-9_.-]+$/.test(value.trim())) return 'Username can only contain letters, numbers, dots, dashes, and underscores.';
        return '';
    }

    function validateEmail(value) {
        if (!value || !value.includes('@')) return 'Please enter a valid email address.';
        return '';
    }

    function validatePassword(value) {
        if (!value || value.length < 8) return 'Password must be at least 8 characters.';
        return '';
    }

    function showError(id, message) {
        const el = document.getElementById(id + '-error');
        const input = document.getElementById(id);
        if (el) el.textContent = message;
        if (input) input.classList.toggle('input-error', !!message);
    }

    function clearErrors() {
        document.querySelectorAll('.form-error').forEach(el => el.textContent = '');
        document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
    }

    // ---------- Registration ----------
    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        registerForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            clearErrors();

            const username = document.getElementById('username').value.trim();
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirm-password').value;

            // Validate
            let valid = true;
            const uErr = validateUsername(username);
            if (uErr) { showError('username', uErr); valid = false; }
            const eErr = validateEmail(email);
            if (eErr) { showError('email', eErr); valid = false; }
            const pErr = validatePassword(password);
            if (pErr) { showError('password', pErr); valid = false; }
            if (password !== confirmPassword) {
                showError('confirm-password', 'Passwords do not match.');
                valid = false;
            }
            if (!valid) return;

            // Show loading
            const btn = document.getElementById('register-btn');
            btn.disabled = true;
            btn.querySelector('.btn-text').hidden = true;
            btn.querySelector('.btn-loading').hidden = false;

            try {
                // Generate keys in browser
                const publicKeyB64 = await SecureChatCrypto.createAndStoreKeyPair();

                // Send to server
                const resp = await fetch('/auth/register', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: JSON.stringify({
                        username: username,
                        email: email,
                        password: password,
                        confirm_password: confirmPassword,
                        public_key: publicKeyB64
                    })
                });

                const data = await resp.json();

                if (data.success) {
                    window.location.href = data.redirect || '/dashboard';
                } else {
                    // Show server-side errors
                    if (data.errors) {
                        for (const [field, msg] of Object.entries(data.errors)) {
                            showError(field, msg);
                        }
                    }
                    if (data.message) {
                        showError('username', data.message);
                    }
                    resetBtn();
                }
            } catch (err) {
                showError('username', 'Network error. Please try again.');
                console.error(err);
                resetBtn();
            }

            function resetBtn() {
                btn.disabled = false;
                btn.querySelector('.btn-text').hidden = false;
                btn.querySelector('.btn-loading').hidden = true;
            }
        });
    }

    // ---------- Login ----------
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            clearErrors();

            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value;

            if (!username) { showError('username', 'Username is required.'); return; }
            if (!password) { showError('password', 'Password is required.'); return; }

            const btn = document.getElementById('login-btn');
            btn.disabled = true;
            btn.querySelector('.btn-text').hidden = true;
            btn.querySelector('.btn-loading').hidden = false;

            try {
                const resp = await fetch('/auth/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: JSON.stringify({ username: username, password: password })
                });

                const data = await resp.json();

                if (data.success) {
                    // Check if we have a keypair stored; if not, warn user
                    const hasKey = await SecureChatCrypto.hasKeyPair();
                    if (!hasKey) {
                        alert('Your private key is not stored in this browser. You can view old messages only if you import your key. New messages will work normally.');
                        // Re-generate keys for new messages
                        const publicKeyB64 = await SecureChatCrypto.createAndStoreKeyPair();
                        // Update public key on server
                        await fetch('/api/update_public_key', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-CSRFToken': getCsrfToken()
                            },
                            body: JSON.stringify({ public_key: publicKeyB64 })
                        });
                    }
                    window.location.href = data.redirect || '/dashboard';
                } else {
                    if (data.message) showError('username', data.message);
                    resetBtn();
                }
            } catch (err) {
                showError('username', 'Network error. Please try again.');
                console.error(err);
                resetBtn();
            }

            function resetBtn() {
                btn.disabled = false;
                btn.querySelector('.btn-text').hidden = false;
                btn.querySelector('.btn-loading').hidden = true;
            }
        });
    }
})();
