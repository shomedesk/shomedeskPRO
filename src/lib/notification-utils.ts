import { db } from './firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

export type NotificationType = 'salary_request' | 'leave_request' | 'document_renewal' | 'system';

export async function createNotification(
  businessId: string,
  title: string,
  message: string,
  type: NotificationType,
  userId?: string, // Optional: if targeting a specific user
  link?: string
) {
  try {
    await addDoc(collection(db, 'notifications'), {
      businessId,
      userId: userId || null,
      title,
      message,
      type,
      status: 'unread',
      link: link || null,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Failed to create notification:', error);
  }
}
