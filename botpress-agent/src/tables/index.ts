// import { Table, z } from '@botpress/runtime'
//
// /**
//  * Structured data storage with CRUD and optional semantic search.
//  * Table names must end with "Table" (e.g. UsersTable, OrdersTable).
//  * Mark string columns as `{ searchable: true, schema: z.string() }` to enable search.
//  * @reserved id, createdAt, updatedAt — auto-managed by the system, do not define them.
//  */
// export const MyTable = new Table({
//   name: 'myTable',
//   description: 'Stores my data',
//   columns: {
//     title: {
//       searchable: true,
//       schema: z.string().describe('Title of the entry'),
//     },
//     status: z.string().describe('Current status of the entry'),
//   },
// })
