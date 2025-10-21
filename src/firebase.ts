// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, signInAnonymously, onAuthStateChanged, User } from "firebase/auth";
import { getStorage } from "firebase/storage";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: "G-RFRW0K2YBG"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Get references to the services we need
const db = getFirestore(app);
const storage = getStorage(app);
export const auth = getAuth(app);

// 匿名認証でサインインし、ユーザー情報を返す
export const signIn = async (): Promise<User> => {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe(); // 最初の状態変更のみをリッスン
      if (user) {
        resolve(user);
      } else {
        signInAnonymously(auth)
          .then((userCredential) => {
            resolve(userCredential.user);
          })
          .catch(reject);
      }
    });
  });
};

export { db, storage };
