/**
 * SecureChat Encryption Module
 * ============================
 * All encryption/decryption happens here in the browser using Web Crypto API.
 * The server NEVER sees plaintext messages or private keys.
 *
 * Hybrid encryption: RSA-OAEP (key exchange) + AES-GCM (message encryption)
 */

const SecureChatCrypto = (() => {
    'use strict';

    const DB_NAME = 'SecureChatKeys';
    const STORE_NAME = 'keys';
    const KEY_ID = 'user-keypair';

    // ---------- IndexedDB helpers ----------

    function openKeyDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = (e) => {
                e.target.result.createObjectStore(STORE_NAME);
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function storeKey(id, keyData) {
        const db = await openKeyDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(keyData, id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function retrieveKey(id) {
        const db = await openKeyDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const request = tx.objectStore(STORE_NAME).get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function deleteKey(id) {
        const db = await openKeyDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    // ---------- Key Generation ----------

    /**
     * Generate RSA-OAEP 2048-bit key pair.
     */
    async function generateKeyPair() {
        const keyPair = await crypto.subtle.generateKey(
            {
                name: 'RSA-OAEP',
                modulusLength: 2048,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: 'SHA-256'
            },
            true,  // extractable so we can export the public key
            ['encrypt', 'decrypt']
        );
        return keyPair;
    }

    /**
     * Generate a random AES-GCM 256-bit session key.
     */
    async function generateSessionKey() {
        return crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,  // extractable so we can encrypt it with RSA
            ['encrypt', 'decrypt']
        );
    }

    // ---------- Export / Import ----------

    async function exportPublicKey(key) {
        const exported = await crypto.subtle.exportKey('spki', key);
        return arrayBufferToBase64(exported);
    }

    async function exportPrivateKey(key) {
        const exported = await crypto.subtle.exportKey('pkcs8', key);
        return arrayBufferToBase64(exported);
    }

    async function importPublicKey(base64) {
        const buffer = base64ToArrayBuffer(base64);
        return crypto.subtle.importKey(
            'spki',
            buffer,
            { name: 'RSA-OAEP', hash: 'SHA-256' },
            true,
            ['encrypt']
        );
    }

    async function importPrivateKey(base64) {
        const buffer = base64ToArrayBuffer(base64);
        return crypto.subtle.importKey(
            'pkcs8',
            buffer,
            { name: 'RSA-OAEP', hash: 'SHA-256' },
            true,
            ['decrypt']
        );
    }

    async function exportSessionKey(key) {
        const exported = await crypto.subtle.exportKey('raw', key);
        return arrayBufferToBase64(exported);
    }

    async function importSessionKey(base64) {
        const buffer = base64ToArrayBuffer(base64);
        return crypto.subtle.importKey(
            'raw',
            buffer,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    // ---------- Encryption ----------

    /**
     * Encrypt a plaintext message with an AES-GCM session key.
     * Returns base64(iv + ciphertext).
     */
    async function encryptMessage(plaintext, sessionKey) {
        const encoder = new TextEncoder();
        const data = encoder.encode(plaintext);
        const iv = crypto.getRandomValues(new Uint8Array(12));

        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            sessionKey,
            data
        );

        // Prepend IV to ciphertext
        const combined = new Uint8Array(iv.length + ciphertext.byteLength);
        combined.set(iv, 0);
        combined.set(new Uint8Array(ciphertext), iv.length);

        return arrayBufferToBase64(combined.buffer);
    }

    /**
     * Decrypt a base64(iv + ciphertext) message with an AES-GCM session key.
     */
    async function decryptMessage(encryptedBase64, sessionKey) {
        const combined = new Uint8Array(base64ToArrayBuffer(encryptedBase64));
        const iv = combined.slice(0, 12);
        const ciphertext = combined.slice(12);

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            sessionKey,
            ciphertext
        );

        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
    }

    /**
     * Encrypt a session key with the recipient's RSA public key.
     */
    async function encryptSessionKey(sessionKey, recipientPublicKey) {
        const rawKey = await crypto.subtle.exportKey('raw', sessionKey);
        const encrypted = await crypto.subtle.encrypt(
            { name: 'RSA-OAEP' },
            recipientPublicKey,
            rawKey
        );
        return arrayBufferToBase64(encrypted);
    }

    /**
     * Decrypt a session key with our RSA private key.
     */
    async function decryptSessionKey(encryptedBase64, privateKey) {
        const buffer = base64ToArrayBuffer(encryptedBase64);
        const rawKey = await crypto.subtle.decrypt(
            { name: 'RSA-OAEP' },
            privateKey,
            buffer
        );
        return crypto.subtle.importKey(
            'raw',
            rawKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    // ---------- Full Keypair Lifecycle ----------

    /**
     * Generate a new keypair and store the private key in IndexedDB.
     * Returns the public key as base64 for uploading to the server.
     */
    async function createAndStoreKeyPair() {
        const keyPair = await generateKeyPair();
        const publicKeyB64 = await exportPublicKey(keyPair.publicKey);
        const privateKeyB64 = await exportPrivateKey(keyPair.privateKey);

        await storeKey(KEY_ID, {
            publicKey: publicKeyB64,
            privateKey: privateKeyB64
        });

        return publicKeyB64;
    }

    /**
     * Retrieve the stored keypair from IndexedDB.
     * Returns { publicKey: CryptoKey, privateKey: CryptoKey } or null.
     */
    async function getKeyPair() {
        const stored = await retrieveKey(KEY_ID);
        if (!stored) return null;

        const privateKey = await importPrivateKey(stored.privateKey);
        const publicKey = await importPublicKey(stored.publicKey);
        return { publicKey, privateKey };
    }

    /**
     * Check if a keypair exists in IndexedDB.
     */
    async function hasKeyPair() {
        const stored = await retrieveKey(KEY_ID);
        return !!stored;
    }

    // ---------- Utility ----------

    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    function base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    // ---------- Public API ----------

    return {
        generateKeyPair,
        generateSessionKey,
        exportPublicKey,
        exportPrivateKey,
        importPublicKey,
        importPrivateKey,
        exportSessionKey,
        importSessionKey,
        encryptMessage,
        decryptMessage,
        encryptSessionKey,
        decryptSessionKey,
        createAndStoreKeyPair,
        getKeyPair,
        hasKeyPair
    };
})();
