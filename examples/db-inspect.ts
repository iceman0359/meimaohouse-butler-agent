/**
 * 数据库查看 CLI —— 查看 schema 结构与表内容。
 *
 *   npm run db:inspect                 # 全库总览：表清单 + 行数 + 各表列结构
 *   npm run db:inspect -- tasks        # 查看 tasks 表结构和最近 20 行数据
 *   npm run db:inspect -- messages 50  # 指定条数
 *
 * 可视化浏览：启动 npm run web 后打开 http://127.0.0.1:8790/db.html
 */
import { openDatabase, closeDatabase, listTables, describeTable, listIndexes, selectRows } from '@meimaohouse/db'

const DB_PATH = process.env.BUTLER_DB_PATH ?? './data/butler.db'
const [tableArg, limitArg] = process.argv.slice(2)

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

async function main() {
  const db = openDatabase({ path: DB_PATH })

  if (!tableArg) {
    /* ---------- 全库总览 ---------- */
    console.log(`\n📦 数据库总览：${DB_PATH}\n`)
    const tables = listTables(db)
    console.log('表清单（用户表，按名称排序）：')
    for (const t of tables) {
      console.log(`  ${pad(t.name, 20)} ${pad(String(t.rowCount) + ' 行', 10)} ${t.ddl.split('\n')[0].slice(0, 60)}…`)
    }
    console.log('\n列结构：')
    for (const t of tables) {
      console.log(`\n  ◆ ${t.name}（${t.rowCount} 行）`)
      for (const c of describeTable(db, t.name)) {
        const flags = [c.pk ? 'PK' : '', c.notnull ? 'NOT NULL' : ''].filter(Boolean).join(' ')
        console.log(`     ${pad(c.name, 20)} ${pad(c.type || '-', 10)} ${flags}${c.dflt_value ? ` DEFAULT ${c.dflt_value}` : ''}`)
      }
    }
    const idx = listIndexes(db)
    console.log(`\n索引（${idx.length} 个）：`)
    for (const i of idx) console.log(`  ${pad(i.tbl_name, 20)} ${i.name}`)
    console.log('\n💡 查看某张表的数据：npm run db:inspect -- <表名> [条数]')
    console.log('💡 可视化浏览：npm run web 后打开 http://127.0.0.1:8790/db.html')
  } else {
    /* ---------- 单表数据 ---------- */
    const limit = Number(limitArg ?? 20) || 20
    const cols = describeTable(db, tableArg)
    console.log(`\n📋 ${tableArg}（${cols.length} 列）`)
    console.log('  ' + cols.map((c) => `${c.name}:${c.type || '-'}`).join('  '))
    const ddl = listTables(db).find((t) => t.name === tableArg)?.ddl
    if (ddl) console.log('\nDDL:\n' + ddl.split('\n').map((l) => '  ' + l).join('\n'))
    const rows = selectRows(db, tableArg, limit)
    console.log(`\n数据（最近 ${rows.length} 行，按 rowid 升序）：`)
    if (rows.length === 0) {
      console.log('  （空表）')
    } else {
      const width = Math.max(...cols.map((c) => c.name.length))
      const pkCol = cols.find((c) => c.pk)?.name ?? cols[0]?.name
      for (const row of rows) {
        console.log(`  ── #${row[pkCol]}`)
        for (const c of cols) {
          const v = row[c.name]
          let text = v === null || v === undefined ? 'NULL' : String(v)
          if (text.length > 80) text = text.slice(0, 77) + '…'
          console.log(`     ${pad(c.name, width)} = ${text}`)
        }
      }
    }
  }
  closeDatabase(db)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
