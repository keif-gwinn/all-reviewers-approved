const core = require('@actions/core');
const github = require('@actions/github');

let octokit;

const extractInputs = () => {
	const pr = parseInt(core.getInput('pr'), 10);

	const token = core.getInput('github-token');
	octokit = github.getOctokit(token);

	return { pr };
};

const getReviewers = async (payload) => {
	const { data } = await octokit.rest.pulls.listRequestedReviewers(payload);

	return [
		...data.users.map(({ login }) => login),
		...data.teams.map(({ name }) => name),
	];
};

const getReviewData = async (prNum) => {
	try {
		const { owner } = github.context.payload.repository;
		const payload = {
			owner: owner.name ?? owner.login,
			repo: github.context.payload.repository.name,
			pull_number: prNum,

		};

		const getReviewStatusProm = octokit.rest.pulls.listReviews(payload).then(
			({ data }) => data.map(({ user, state }) => ({ state, user: user.login })),
		);

		return Promise.all([getReviewers(payload), getReviewStatusProm]);
	} catch ({ message }) {
		throw new Error(`Failed to find PR: ${message}`);
	}
};

const run = async () => {
	const { pr } = extractInputs();
	if (!pr) {
		throw new Error('PR number not provided');
	}

	const [reviewers, reviews] = await getReviewData(pr);

	let waitingOnReviews = !!reviewers.length;

	if (!waitingOnReviews) {
		const reviewerApproved = {};

		reviews.forEach(({ user, state }) => {
			if (!reviewerApproved[user]) {
				switch (state) {
				case 'APPROVED':
					reviewerApproved[user] = true;
					break;
				case 'COMMENTED':
					break;
				default:
					reviewerApproved[user] = false;
				}
			}
		});

		Object.keys(reviewerApproved).forEach((user) => {
			if (!reviewerApproved[user]) {
				waitingOnReviews = true;
			}
		});
	}

	if (waitingOnReviews) throw new Error('Not all reviewers have approved this PR');

	console.log('All reviewers have approved');
};
run().catch((err) => {
	core.setFailed(err.message);
});
