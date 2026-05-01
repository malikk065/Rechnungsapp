// Firebase Konfiguration
const firebaseConfig = {
  apiKey: "AIzaSyAM4ZYcgvNMcTSA9e76r7XlHoZP4q6kO7Q",
  authDomain: "rechnungsapp-de890.firebaseapp.com",
  projectId: "rechnungsapp-de890",
  storageBucket: "rechnungsapp-de890.firebasestorage.app",
  messagingSenderId: "921370894998",
  appId: "1:921370894998:web:cd7aa6c66fc7abc132d8b7"
};

// Firebase initialisieren
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
