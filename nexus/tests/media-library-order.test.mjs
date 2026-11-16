// SPDX-License-Identifier: MIT
// Source-behavior regression for the Steam `video` FFmpeg directories. It
// parses the actual `proton` script, executes only the real library-path
// statements and the real prepend/append helpers with in-memory globals, and
// checks the resulting LD_LIBRARY_PATH. No module import, prefix, filesystem
// write, temporary file, Git access, os.sync, Wine or game execution. Not a
// runtime build or game claim.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const proton = path.join(root, 'proton');

// argv: source file, JSON scenarios.
const driver = String.raw`
import ast, json, sys, types

source_path, scenarios = sys.argv[1], json.loads(sys.argv[2])

def method(tree, cls, name):
    classes = [n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == cls]
    found = [n for n in classes[0].body if isinstance(n, ast.FunctionDef) and n.name == name] if len(classes) == 1 else []
    if len(found) != 1:
        raise SystemExit('expected exactly one ' + cls + '.' + name)
    return found[0]

def media_calls(node):
    return [n for n in ast.walk(node) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
            and n.func.id in ('prepend_to_env_str', 'append_to_env_str') and 'ubuntu12_64/video/' in ast.unparse(n)]

def library_statements(tree):
    # The real init_wine statements that build the bundled library list and
    # prepend it, plus the real late Steam video statement from setup_prefix.
    init = method(tree, 'Session', 'init_wine')
    start = next(i for i, n in enumerate(init.body)
                 if isinstance(n, ast.Assign) and any(getattr(t, 'id', None) == 'ld_library_path' for t in n.targets))
    calls = media_calls(method(tree, 'CompatData', 'setup_prefix'))
    if len(calls) != 1:
        raise SystemExit('expected exactly one Steam video statement')
    return init.body[start:start + 2] + [ast.Expr(value=calls[0])]

def helpers(tree):
    return [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in ('prepend_to_env_str', 'append_to_env_str')]

def wrapper(body):
    # The real statements, unchanged, inside a plain function so they run with
    # this namespace as globals.
    return ast.Module(body=[ast.FunctionDef(name='run_actual', args=ast.arguments(posonlyargs=[], args=[],
        vararg=None, kwonlyargs=[], kw_defaults=[], kwarg=None, defaults=[]), body=body,
        decorator_list=[], returns=None, type_params=[])], type_ignores=[])

def run(tree, inherited, runtime, steam):
    env = {} if inherited is None else {'LD_LIBRARY_PATH': inherited}
    session = types.SimpleNamespace(env=env)
    namespace = {'g_proton': types.SimpleNamespace(lib_dir=runtime + '/files/lib/'), 'g_session': session,
                 'self': session, 'ld_path_var': 'LD_LIBRARY_PATH', 'steam_linux_path': steam}
    statements = library_statements(tree)
    for helper in helpers(tree):
        exec(compile(ast.Module(body=[helper], type_ignores=[]), source_path, 'exec'), namespace)
    for body in (statements[:2], statements[2:]):
        exec(compile(ast.fix_missing_locations(wrapper(body)), source_path, 'exec'), namespace)
        namespace['run_actual']()
    return env.get('LD_LIBRARY_PATH')

tree = ast.parse(open(source_path, encoding='utf-8').read(), source_path)

# Actual call order: __main__ runs init_wine before init_session, and the real
# init_session calls setup_prefix only when update_prefix_files is true.
main = next(n for n in tree.body if isinstance(n, ast.If) and '__name__' in ast.unparse(n.test))
names = [ast.unparse(n.value.func) for n in main.body if isinstance(n, ast.Expr) and isinstance(n.value, ast.Call)]
order = names.index('g_session.init_wine') < names.index('g_session.init_session')
gated = any(isinstance(n, ast.If) and ast.unparse(n.test) == 'update_prefix_files'
            and any(isinstance(c, ast.Call) and ast.unparse(c.func) == 'g_compatdata.setup_prefix' for c in ast.walk(n))
            for n in ast.walk(method(tree, 'Session', 'init_session')))

result = {'callOrder': order, 'gated': gated, 'scenarios': {}}
for scenario in scenarios:
    result['scenarios'][scenario['label']] = run(tree, scenario['inherited'], scenario['runtime'], scenario['steam'])
print(json.dumps(result))
`;

function evaluate(scenarios) {
  const environment = {...process.env};
  for (const name of ['LD_LIBRARY_PATH', 'ORIG_LD_LIBRARY_PATH', 'HOME', 'XDG_CONFIG_HOME']) delete environment[name];
  const result = spawnSync('python3', ['-B', '-c', driver, proton, JSON.stringify(scenarios)], {
    cwd: root, env: {...environment, PYTHONDONTWRITEBYTECODE: '1'}, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

const runtime = '/isolated/runtime';
const steam = '/isolated/steam';
const libraries = ['x86_64-linux-gnu', 'aarch64-linux-gnu', 'i386-linux-gnu'].map(arch => `${runtime}/files/lib/${arch}`);
const videos = ['ubuntu12_64/video', 'ubuntu12_32/video', 'steamrtarm64/video'].map(entry => `${steam}/${entry}/`);
const scenarios = [
  {label: 'unset', inherited: null},
  {label: 'inherited', inherited: '/custom/one:/custom/two'},
  {label: 'explicit empty', inherited: ''},
].map(scenario => ({...scenario, runtime, steam}));
const inheritedEntries = scenario => scenario.inherited === null ? [] : scenario.inherited.split(':');

test('the actual script calls init_wine before init_session and gates setup_prefix', () => {
  const result = evaluate([]);
  assert.equal(result.callOrder, true);
  assert.equal(result.gated, true);
});

test('the runtime libraries precede Steam video directories, which remain as fallback', () => {
  const {scenarios: results} = evaluate(scenarios);
  for (const scenario of scenarios) {
    assert.deepEqual(results[scenario.label].split(':'),
      [...libraries, ...inheritedEntries(scenario), ...videos], scenario.label);
  }
});
