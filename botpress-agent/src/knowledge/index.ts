// import { Knowledge, DataSource } from '@botpress/runtime'
//
// /**
//  * A RAG-powered knowledge base for semantic search and AI-grounded responses.
//  * Data sources: Directory (local .md/.pdf), Website (sitemap/URLs), or Table.
//  * Pass to `execute({ knowledge: [MyKB] })` to make the AI use it when answering.
//  */
// const mySource = DataSource.Directory.fromPath('src/knowledge', {
//   id: 'my-docs',
//   filter: (filePath) => filePath.endsWith('.md') || filePath.endsWith('.pdf'),
// })
//
// export const MyKB = new Knowledge({
//   name: 'my-knowledge',
//   description: 'My knowledge base',
//   sources: [mySource],
// })
