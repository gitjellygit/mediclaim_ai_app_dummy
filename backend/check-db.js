const { PrismaClient } = require('@prisma/client');

async function checkDatabase() {
  const prisma = new PrismaClient();
  
  try {
    console.log('=== DATABASE CHECK ===');
    
    const claims = await prisma.claim.findMany();
    console.log('Total claims:', claims.length);
    
    const documents = await prisma.document.findMany();
    console.log('Total documents:', documents.length);
    
    const documentsWithClaimId = await prisma.document.findMany({
      where: { claimId: { not: null } }
    });
    console.log('Documents with claimId:', documentsWithClaimId.length);
    
    // Show sample data
    if (claims.length > 0) {
      console.log('Sample claim:', claims[0]);
    }
    
    if (documents.length > 0) {
      console.log('Sample document:', documents[0]);
    }
    
    if (documentsWithClaimId.length > 0) {
      console.log('Sample document with claimId:', documentsWithClaimId[0]);
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkDatabase();
