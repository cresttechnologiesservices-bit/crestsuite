// Seeds user accounts on first run. No sample/demo records are created —
// all quality data is entered through the application.
const { load, newId, saveNow } = require('./db');
const { hashPassword } = require('./auth');
const trail = require('./audittrail');

function mkUser(email, name, role, department, password) {
  const { salt, hash } = hashPassword(password);
  return { id: newId('usr'), email, name, role, department, salt, passHash: hash, active: true, createdAt: new Date().toISOString() };
}

function ensureSeed() {
  const db = load();
  if (db.users.length) return; // already seeded

  console.log('Seeding QMS user accounts...');

  // Owner / super-admin
  const owner = mkUser('hirkant@gmail.com', 'Hirkant', 'admin', 'Management / Owner', 'Owner@123');
  // Admin role
  const adminUsers = [
    mkUser('raj@crest-technologies.com', 'Raj', 'admin', 'Management', 'Admin@123'),
    mkUser('prabha@crestaerospace.com', 'Prabha', 'admin', 'Management', 'Admin@123'),
    mkUser('ashwini.kumar@crestaerospace.com', 'Ashwini Kumar', 'admin', 'Quality Systems', 'Admin@123'),
    mkUser('mayurraju.shah@crestaerospace.com', 'Mayurraju Shah', 'admin', 'Operations', 'Admin@123'),
    mkUser('pradnya.n@crestaerospace.com', 'Pradnya N', 'admin', 'Quality Systems', 'Admin@123')
  ];
  // Manager role (Quality Manager permissions in the app)
  const managerUsers = [
    mkUser('vishal.bhandary@crestaerospace.com', 'Vishal Bhandary', 'quality', 'Quality Assurance', 'Manager@123'),
    mkUser('jayanthkumar.singh@crestaerospace.com', 'Jayanthkumar Singh', 'quality', 'Quality Assurance', 'Manager@123'),
    mkUser('gundappa.chatla@crestaerospace.com', 'Gundappa Chatla', 'quality', 'Production', 'Manager@123'),
    mkUser('prajwal.kulkarni@crestaerospace.com', 'Prajwal Kulkarni', 'quality', 'Manufacturing Engineering', 'Manager@123'),
    mkUser('sooriyaprakash.m@crestaerospace.com', 'Sooriyaprakash M', 'quality', 'Supplier Quality', 'Manager@123')
  ];
  db.users.push(owner, ...adminUsers, ...managerUsers);

  saveNow();
  trail.record(null, 'SEED', 'system', null, `Seeded ${db.users.length} user accounts (no sample data)`);
  console.log('Seed complete. Owner: hirkant@gmail.com/Owner@123 · Admins: Admin@123 · Managers: Manager@123');
}

if (require.main === module) { load(); ensureSeed(); }
module.exports = { ensureSeed };
