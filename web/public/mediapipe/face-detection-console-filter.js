(() => {
  const shouldHideMediapipeLog = (args) => {
    const text = args.map((item) => String(item)).join(" ");
    return (
      /^\s*[IWEF]\d{4}\s/.test(text) ||
      text.includes("gl_context") ||
      text.includes("OpenGL error checking is disabled") ||
      text.includes("Successfully created a WebGL context") ||
      text.includes("Successfully destroyed WebGL context")
    );
  };

  const filterConsole = (method) =>
    function filteredMediapipeConsole(...args) {
      if (!shouldHideMediapipeLog(args)) method.apply(console, args);
    };

  console.log = filterConsole(console.log);
  console.info = filterConsole(console.info);
  console.warn = filterConsole(console.warn);
})();
