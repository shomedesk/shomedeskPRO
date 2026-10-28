import { db } from '../lib/firebase';
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';

export async function getBusinessContext(businessId: string) {
  try {
    // Fetch branches
    const branchesSnap = await getDocs(query(collection(db, 'branches'), where('businessId', '==', businessId)));
    const branches = branchesSnap.docs.map(d => d.data());

    // Fetch employees
    const employeesSnap = await getDocs(query(collection(db, 'employees'), where('businessId', '==', businessId)));
    const employees = employeesSnap.docs.map(d => d.data());

    // Fetch bank accounts
    const banksSnap = await getDocs(query(collection(db, 'bankAccounts'), where('businessId', '==', businessId)));
    const banks = banksSnap.docs.map(d => d.data());

    // Fetch branch documents (Document Vault)
    const docsSnap = await getDocs(query(collection(db, 'branchDocuments'), where('businessId', '==', businessId)));
    const documents = docsSnap.docs.map(d => d.data());

    // Fetch recent reports (last 5)
    // Note: This might require a composite index. If it fails, we'll fallback to a simpler query.
    let reports: any[] = [];
    try {
      const reportsSnap = await getDocs(query(
        collection(db, 'dailyReports'), 
        where('businessId', '==', businessId),
        orderBy('date', 'desc'),
        limit(5)
      ));
      reports = reportsSnap.docs.map(d => d.data());
    } catch (reportError) {
      console.warn('Failed to fetch ordered reports, falling back to unordered:', reportError);
      const reportsSnap = await getDocs(query(
        collection(db, 'dailyReports'), 
        where('businessId', '==', businessId),
        limit(20)
      ));
      reports = reportsSnap.docs.map(d => d.data()).slice(-5);
    }

    return {
      branches,
      employees,
      banks,
      documents,
      reports,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error gathering business context:', error);
    return null;
  }
}
