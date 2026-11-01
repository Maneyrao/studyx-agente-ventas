import type { AccessTemplateConfig } from '@/features/fulfillment/post-sale/access-template';

// Synthetic credentials and contacts: no Central or provider is contacted.
export const postSaleAccessTestConfig: AccessTemplateConfig = {
  campusUrl: 'https://campus.example.test/virtual',
  officialWhatsapp: '786-916-4372',
  studentSupportPhone: '866-217-7282',
  adminEmail: 'admin@example.test',
  teachersEmail: 'teachers@example.test',
  initialPassword: 'Efixture.123',
};
