/**
 * CI Environment Detection
 *
 * Detects CI/CD environment and extracts relevant context
 * (branch, commit SHA, PR number) for proper scan association.
 */

export interface CIContext {
  /** CI provider name */
  provider: 'github-actions' | 'gitlab-ci' | 'circleci' | 'jenkins' | 'unknown';
  /** Git branch name */
  branch?: string;
  /** Git commit SHA */
  commitSha?: string;
  /** Pull/Merge request number */
  prNumber?: number;
  /** Repository name (owner/repo) */
  repository?: string;
  /** Whether this is a PR/MR event */
  isPullRequest: boolean;
}

/**
 * Detect CI environment and extract context
 */
export function detectCIContext(): CIContext | null {
  // GitHub Actions
  if (process.env['GITHUB_ACTIONS'] === 'true') {
    return detectGitHubActions();
  }

  // GitLab CI
  if (process.env['GITLAB_CI'] === 'true') {
    return detectGitLabCI();
  }

  // CircleCI
  if (process.env['CIRCLECI'] === 'true') {
    return detectCircleCI();
  }

  // Jenkins
  if (process.env['JENKINS_URL']) {
    return detectJenkins();
  }

  // Not in CI
  return null;
}

/**
 * Detect GitHub Actions context
 */
function detectGitHubActions(): CIContext {
  const eventName = process.env['GITHUB_EVENT_NAME'];
  const isPullRequest = eventName === 'pull_request' || eventName === 'pull_request_target';

  // For PRs, use the head branch; for pushes, parse from GITHUB_REF
  let branch: string | undefined;
  if (isPullRequest) {
    branch = process.env['GITHUB_HEAD_REF'];
  } else {
    const ref = process.env['GITHUB_REF'] || '';
    // refs/heads/main -> main
    branch = ref.replace(/^refs\/heads\//, '');
  }

  // For PRs, GITHUB_SHA is the merge commit; use GITHUB_HEAD_REF's SHA
  // Actually, GITHUB_SHA in PR context is already the head SHA
  const commitSha = process.env['GITHUB_SHA'];

  // Extract PR number from GITHUB_REF for pull_request events
  // Format: refs/pull/123/merge
  let prNumber: number | undefined;
  if (isPullRequest) {
    const prRef = process.env['GITHUB_REF'] || '';
    const match = prRef.match(/refs\/pull\/(\d+)/);
    if (match && match[1]) {
      prNumber = parseInt(match[1], 10);
    }
  }

  return {
    provider: 'github-actions',
    branch,
    commitSha,
    prNumber,
    repository: process.env['GITHUB_REPOSITORY'],
    isPullRequest,
  };
}

/**
 * Detect GitLab CI context
 */
function detectGitLabCI(): CIContext {
  const mrIid = process.env['CI_MERGE_REQUEST_IID'];
  const isPullRequest = !!mrIid;

  let prNumber: number | undefined;
  if (mrIid) {
    prNumber = parseInt(mrIid, 10);
  }

  return {
    provider: 'gitlab-ci',
    branch: process.env['CI_COMMIT_REF_NAME'],
    commitSha: process.env['CI_COMMIT_SHA'],
    prNumber,
    repository: process.env['CI_PROJECT_PATH'],
    isPullRequest,
  };
}

/**
 * Detect CircleCI context
 */
function detectCircleCI(): CIContext {
  let prNumber: number | undefined;
  const prUrl = process.env['CIRCLE_PULL_REQUEST'];
  if (prUrl) {
    const match = prUrl.match(/\/pull\/(\d+)/);
    if (match && match[1]) {
      prNumber = parseInt(match[1], 10);
    }
  }

  return {
    provider: 'circleci',
    branch: process.env['CIRCLE_BRANCH'],
    commitSha: process.env['CIRCLE_SHA1'],
    prNumber,
    repository: `${process.env['CIRCLE_PROJECT_USERNAME']}/${process.env['CIRCLE_PROJECT_REPONAME']}`,
    isPullRequest: !!prUrl,
  };
}

/**
 * Detect Jenkins context
 */
function detectJenkins(): CIContext {
  const changeId = process.env['CHANGE_ID'];
  const isPullRequest = !!changeId;

  let prNumber: number | undefined;
  if (changeId) {
    prNumber = parseInt(changeId, 10);
  }

  return {
    provider: 'jenkins',
    branch: process.env['BRANCH_NAME'] || process.env['GIT_BRANCH'],
    commitSha: process.env['GIT_COMMIT'],
    prNumber,
    isPullRequest,
  };
}
