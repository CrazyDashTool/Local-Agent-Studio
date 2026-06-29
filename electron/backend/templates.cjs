const { writeTextFile } = require("./files.cjs");

const PROJECT_TEMPLATES = [
  {
    id: "work",
    label: "Work",
    description: "Notes, tasks, meetings, and lightweight planning docs.",
    files: [
      { path: "Work/README.md", content: "# Work\n\nUse this folder for notes, tasks, meeting summaries, and project planning.\n" },
      { path: "Work/tasks.md", content: "# Tasks\n\n- [ ] First task\n- [ ] Follow-up\n" },
      { path: "Work/meetings.md", content: "# Meetings\n\n## Notes\n\n" },
    ],
  },
  {
    id: "dev",
    label: "Dev",
    description: "A small coding workspace with docs, source, and scripts folders.",
    files: [
      { path: "Dev/README.md", content: "# Dev Project\n\nDescribe the app, setup steps, and architecture notes here.\n" },
      { path: "Dev/src/main.py", content: "def main():\n    print(\"Hello from Local Agent Studio\")\n\nif __name__ == \"__main__\":\n    main()\n" },
      { path: "Dev/TODO.md", content: "# TODO\n\n- [ ] Design the first feature\n- [ ] Add tests\n" },
    ],
  },
  {
    id: "fun",
    label: "Fun",
    description: "Creative prompts, image ideas, and experiments.",
    files: [
      { path: "Fun/prompts.md", content: "# Creative Prompts\n\n- A cinematic local AI desktop app screenshot\n- A playful product mascot concept\n" },
      { path: "Fun/ideas.md", content: "# Ideas\n\n" },
    ],
  },
  {
    id: "research",
    label: "Research",
    description: "Research questions, sources, summaries, and datasets.",
    files: [
      { path: "Research/questions.md", content: "# Research Questions\n\n- What do we need to learn?\n" },
      { path: "Research/sources.md", content: "# Sources\n\n" },
      { path: "Research/summary.md", content: "# Summary\n\n" },
    ],
  },
];

function listProjectTemplates() {
  return { templates: PROJECT_TEMPLATES };
}

function applyProjectTemplate({ settings, templateId }) {
  const template = PROJECT_TEMPLATES.find((item) => item.id === templateId);
  if (!template) {
    throw new Error(`Unknown template: ${templateId}`);
  }
  const files = template.files.map((file) =>
    writeTextFile({
      settings,
      filePath: file.path,
      content: file.content,
      overwrite: false,
    }),
  );
  return {
    template,
    files,
  };
}

module.exports = {
  applyProjectTemplate,
  listProjectTemplates,
};
