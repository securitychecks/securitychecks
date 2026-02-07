/**
 * Explain command - explain an invariant and show required proofs
 */

import pc from 'picocolors';
import { getInvariantById, ALL_INVARIANTS } from '@securitychecks/collector';

export async function explainCommand(invariantId: string): Promise<void> {
  const invariant = getInvariantById(invariantId);

  if (!invariant) {
    console.log(pc.red(`\nUnknown invariant: ${invariantId}\n`));
    console.log(pc.bold('Available invariants:\n'));

    for (const inv of ALL_INVARIANTS) {
      const severityColor =
        inv.severity === 'P0' ? pc.red : inv.severity === 'P1' ? pc.yellow : pc.blue;
      console.log(`  ${severityColor(`[${inv.severity}]`)} ${inv.id}`);
      console.log(pc.dim(`       ${inv.name}`));
    }
    console.log('');
    return;
  }

  const severityColor =
    invariant.severity === 'P0' ? pc.red : invariant.severity === 'P1' ? pc.yellow : pc.blue;

  console.log('');
  console.log(severityColor(pc.bold(`[${invariant.severity}] ${invariant.id}`)));
  console.log(pc.bold(invariant.name));
  console.log('');

  console.log(pc.bold('Description:'));
  console.log(wrapText(invariant.description, 80, 2));
  console.log('');

  console.log(pc.bold('Category:'));
  console.log(`  ${invariant.category}`);
  console.log('');

  console.log(pc.bold('Required Proof:'));
  console.log(wrapText(invariant.requiredProof, 80, 2));
  console.log('');

  if (invariant.documentationUrl) {
    console.log(pc.bold('Documentation:'));
    console.log(`  ${invariant.documentationUrl}`);
    console.log('');
  }
}

function wrapText(text: string, maxWidth: number, indent: number): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';
  const prefix = ' '.repeat(indent);

  for (const word of words) {
    if (currentLine.length + word.length + 1 > maxWidth - indent) {
      lines.push(prefix + currentLine.trim());
      currentLine = word;
    } else {
      currentLine += (currentLine ? ' ' : '') + word;
    }
  }

  if (currentLine) {
    lines.push(prefix + currentLine.trim());
  }

  return lines.join('\n');
}
