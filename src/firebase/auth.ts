import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { useEffect, useState } from "react";
import { auth } from "./firebase";

export function useAuthUser() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthLoading(false);
    });

    return unsubscribe;
  }, []);

  return { user, authLoading };
}

export function signInWithEmail(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function createAccountWithEmail(email: string, password: string, userName: string) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const trimmedUserName = userName.trim();

  if (trimmedUserName) {
    await updateProfile(credential.user, { displayName: trimmedUserName });
  }

  return credential;
}

export function requestPasswordReset(email: string) {
  return sendPasswordResetEmail(auth, email);
}

export function getUserName(user: User) {
  return user.displayName?.trim() || user.email?.split("@")[0] || "User";
}

export function signOutCurrentUser() {
  return signOut(auth);
}
