// Fills a freshly deployed local chain with a term of demo data.
//
//   npx hardhat run scripts/seed.js --network localhost
//
// The node has to start in the past so there is room to lay out the term
// before the chain catches up with the wall clock:
//
//   CHAIN_START_DAYS_AGO=70 npx hardhat node
//
// Names, roll numbers and emails go to the backend (POST /profiles) when it is
// reachable at BACKEND_URL (default http://localhost:4000/api, empty to skip).
// Otherwise idHash is computed locally with the dev salt, which must match the
// backend's ID_SALT for the profiles to line up later.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const { ethers, network } = hre;

const DEV_SALT = ethers.keccak256(ethers.toUtf8Bytes("attendcoin-dev-salt"));
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000/api";
const DAY = 86_400;
const HOUR = 3_600;
const MINUTE = 60;
const SESSIONS_PER_COURSE = 8;
const SESSION_DURATION = 75 * MINUTE;
const LIVE_SESSION_DURATION = 4 * HOUR;

// Hardhat accounts 4..11, in this order.
const STUDENTS = [
  { name: "Ayesha Siddiqui", rollNumber: "22K-4101", email: "ayesha.siddiqui@students.example.edu", rate: 0.95 },
  { name: "Daniel Okafor", rollNumber: "22K-4102", email: "daniel.okafor@students.example.edu", rate: 0.88 },
  { name: "Mei Lin Chen", rollNumber: "22K-4107", email: "meilin.chen@students.example.edu", rate: 1.0 },
  { name: "Rohan Mehta", rollNumber: "22K-4113", email: "rohan.mehta@students.example.edu", rate: 0.78 },
  { name: "Sofia Alvarez", rollNumber: "22K-4118", email: "sofia.alvarez@students.example.edu", rate: 0.9 },
  { name: "Hamza Qureshi", rollNumber: "22K-4124", email: "hamza.qureshi@students.example.edu", rate: 0.62 },
  { name: "Emily Carter", rollNumber: "22K-4131", email: "emily.carter@students.example.edu", rate: 0.82 },
  { name: "Yusuf Demir", rollNumber: "22K-4139", email: "yusuf.demir@students.example.edu", rate: 0.7 },
];

// `teacher` is a Hardhat account index, `students` are 0-based indices into STUDENTS.
// `days` are offsets within a week and `hour` is UTC; both only matter for the timeline.
const COURSES = [
  {
    code: "CS-3001",
    title: "Blockchain and Cryptocurrency",
    room: "CS Lab 3",
    schedule: "Mon, Wed 09:00",
    teacher: 1,
    students: [0, 1, 2, 3, 4, 5, 6, 7],
    days: [0, 2],
    hour: 9,
  },
  {
    code: "CS-2005",
    title: "Database Systems",
    room: "Room B-204",
    schedule: "Tue, Thu 11:00",
    teacher: 2,
    students: [0, 1, 2, 3, 4, 5],
    days: [1, 3],
    hour: 11,
  },
  {
    code: "MT-2005",
    title: "Probability and Statistics",
    room: "Room A-112",
    schedule: "Fri 14:00",
    teacher: 1,
    students: [2, 3, 4, 5, 6, 7],
    days: [4],
    hour: 14,
  },
];

const ITEMS = [
  { name: "Cafeteria meal voucher", price: "25", stock: 200, limit: 4 },
  { name: "Printing credits (100 pages)", price: "15", stock: 500, limit: 0 },
  { name: "Library late-fee waiver", price: "40", stock: 60, limit: 1 },
  { name: "Extended library hours pass", price: "60", stock: 40, limit: 2 },
  { name: "Lab priority booking", price: "80", stock: 25, limit: 1 },
];

const TICKET_TYPES = {
  Ticket: [
    { name: "sessionId", type: "uint256" },
    { name: "issuedAt", type: "uint64" },
  ],
};

const CHECKIN_TYPES = {
  CheckIn: [
    { name: "sessionId", type: "uint256" },
    { name: "student", type: "address" },
    { name: "issuedAt", type: "uint64" },
    { name: "ticketHash", type: "bytes32" },
  ],
};

const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

// Deterministic so every seeded chain shows the same attendance.
function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function localIdHash(rollNumber) {
  return ethers.keccak256(ethers.solidityPacked(["bytes32", "string"], [DEV_SALT, rollNumber]));
}

async function latestTimestamp() {
  return (await ethers.provider.getBlock("latest")).timestamp;
}

async function advanceTo(timestamp) {
  const now = await latestTimestamp();
  if (timestamp <= now) return;
  await network.provider.send("evm_increaseTime", [timestamp - now]);
  await network.provider.send("evm_mine");
}

function loadDeployment() {
  const file = process.env.DEPLOYMENT_FILE
    ? path.resolve(process.env.DEPLOYMENT_FILE)
    : path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`No deployment at ${file}. Run scripts/deploy.js on this network first.`);
  }
  return { file, deployment: JSON.parse(fs.readFileSync(file, "utf8")) };
}

class Backend {
  constructor(baseUrl, admin) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.admin = admin;
  }

  static async connect(baseUrl, admin, chainId) {
    if (!baseUrl) return null;
    try {
      const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return null;
      const health = await res.json();
      if (Number(health.chainId) !== chainId) {
        console.warn(`Backend at ${baseUrl} is on chain ${health.chainId}, not ${chainId}. Ignoring it.`);
        return null;
      }
      return new Backend(baseUrl, admin);
    } catch {
      return null;
    }
  }

  async authHeaders() {
    const timestamp = Date.now().toString();
    const message = `AttendCoin admin request\nAddress: ${this.admin.address}\nTimestamp: ${timestamp}`;
    return {
      "x-auth-address": this.admin.address,
      "x-auth-timestamp": timestamp,
      "x-auth-signature": await this.admin.signMessage(message),
    };
  }

  async request(method, route, body) {
    const res = await fetch(`${this.baseUrl}${route}`, {
      method,
      headers: { "content-type": "application/json", ...(await this.authHeaders()) },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const reason = data.error ? `${data.error.code}: ${data.error.message}` : res.statusText;
      throw new Error(`${method} ${route} failed (${res.status}) ${reason}`);
    }
    return data;
  }

  createProfile(profile) {
    return this.request("POST", "/profiles", profile);
  }

  setCourseMeta(courseId, meta) {
    return this.request("PUT", `/courses/${courseId}/meta`, meta);
  }
}

async function ensureRole(contract, role, account) {
  if (!(await contract.hasRole(role, account))) {
    await (await contract.grantRole(role, account)).wait();
  }
}

// Every session of the term in chronological order, as offsets from the term start.
function buildTimeline() {
  const slots = [];
  COURSES.forEach((course, c) => {
    for (let n = 0; n < SESSIONS_PER_COURSE; n++) {
      const week = Math.floor(n / course.days.length);
      const day = week * 7 + course.days[n % course.days.length];
      slots.push({ courseIndex: c, offset: day * DAY + course.hour * HOUR });
    }
  });
  return slots.sort((a, b) => a.offset - b.offset);
}

async function main() {
  const { file: deploymentFile, deployment } = loadDeployment();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 31337) {
    throw new Error(`Refusing to seed chain ${chainId}. The demo data uses Hardhat's public dev accounts.`);
  }

  const signers = await ethers.getSigners();
  if (signers.length < 12) throw new Error("Need at least 12 unlocked accounts (Hardhat node default is 20).");
  const [admin, , , vendor] = signers;
  const studentSigners = signers.slice(4, 4 + STUDENTS.length);

  const { AttendCoin, AttendanceManager, RewardStore } = deployment.contracts;
  const token = await ethers.getContractAt("AttendCoin", AttendCoin, admin);
  const manager = await ethers.getContractAt("AttendanceManager", AttendanceManager, admin);
  const store = await ethers.getContractAt("RewardStore", RewardStore, admin);

  const [studentCount, courseCount, itemCount] = await Promise.all([
    manager.studentCount(),
    manager.courseCount(),
    store.itemCount(),
  ]);
  if (studentCount > 0n || courseCount > 0n || itemCount > 0n) {
    throw new Error(
      `This deployment already has data (${studentCount} students, ${courseCount} courses, ${itemCount} items). ` +
        "Restart the node and redeploy to seed again.",
    );
  }

  // The term is squeezed into however far the chain clock is behind the wall
  // clock. Squeeze too hard and a course's sessions land within MIN_SESSION_GAP
  // of each other, which the contract rejects halfway through seeding.
  const timeline = buildTimeline();
  const termLength = timeline[timeline.length - 1].offset + SESSION_DURATION + 3 * DAY;
  const room = Math.floor(Date.now() / 1000) - (await latestTimestamp()) - DAY;
  const scale = Math.min(1, room / termLength);
  const minGap = Number(await manager.MIN_SESSION_GAP());
  if (scale * DAY < minGap) {
    throw new Error(
      `The chain clock needs to start about ${Math.ceil(termLength / DAY) + 2} days in the past to fit the term. ` +
        "Restart the node with CHAIN_START_DAYS_AGO=70 npx hardhat node, then deploy and seed again.",
    );
  }

  console.log(`Seeding ${network.name} using ${path.relative(process.cwd(), deploymentFile)}`);

  const backend = await Backend.connect(BACKEND_URL, admin, chainId);
  console.log(backend ? `Profiles: backend at ${BACKEND_URL}` : "Profiles: backend not reachable, hashing roll numbers locally");

  // Roles
  const TEACHER_ROLE = await manager.TEACHER_ROLE();
  await ensureRole(manager, TEACHER_ROLE, signers[1].address);
  await ensureRole(manager, TEACHER_ROLE, signers[2].address);
  await ensureRole(store, await store.VENDOR_ROLE(), vendor.address);

  // Students
  const idHashes = [];
  for (let i = 0; i < STUDENTS.length; i++) {
    const { name, rollNumber, email } = STUDENTS[i];
    const local = localIdHash(rollNumber);
    if (!backend) {
      idHashes.push(local);
      continue;
    }
    const { idHash } = await backend.createProfile({ wallet: studentSigners[i].address, name, rollNumber, email });
    if (idHash.toLowerCase() !== local.toLowerCase()) {
      console.warn(`Backend idHash for ${rollNumber} differs from the dev salt. Is ID_SALT set to the dev value?`);
    }
    idHashes.push(idHash);
  }
  await (await manager.registerStudents(studentSigners.map((s) => s.address), idHashes)).wait();
  const studentIds = await Promise.all(studentSigners.map((s) => manager.studentIdOf(s.address)));
  console.log(`Registered ${STUDENTS.length} students`);

  // Courses
  const courseIds = [];
  for (const course of COURSES) {
    const teacher = signers[course.teacher].address;
    const id = await manager.createCourse.staticCall(course.code, teacher);
    await (await manager.createCourse(course.code, teacher)).wait();
    await (await manager.enrollStudents(id, course.students.map((i) => studentIds[i]))).wait();
    if (backend) {
      await backend.setCourseMeta(id, { title: course.title, room: course.room, schedule: course.schedule });
    }
    courseIds.push(id);
    console.log(`Course ${id}: ${course.code} ${course.title}, ${course.students.length} enrolled`);
  }

  // Catalogue
  for (const item of ITEMS) {
    await (await store.createItem(item.name, "", ethers.parseEther(item.price), item.stock, item.limit)).wait();
  }
  console.log(`Created ${ITEMS.length} store items`);

  // Past sessions
  const termStart = Math.ceil((await latestTimestamp()) / DAY) * DAY;
  const advance = async (seconds) => {
    await advanceTo((await latestTimestamp()) + Math.max(1, Math.round(seconds * scale)));
  };

  const random = mulberry32(2026);
  const { chainId: domainChainId } = await ethers.provider.getNetwork();
  const domain = { name: "AttendCoin Attendance", version: "1", chainId: domainChainId, verifyingContract: AttendanceManager };
  const totals = { sessions: 0, checkIns: 0, manual: 0, absent: 0 };

  for (const slot of timeline) {
    const course = COURSES[slot.courseIndex];
    const courseId = courseIds[slot.courseIndex];
    const teacher = signers[course.teacher];
    await advanceTo(termStart + Math.round(slot.offset * scale));

    const ephemeral = ethers.Wallet.createRandom();
    const tx = await manager.connect(teacher).openSession(courseId, SESSION_DURATION, ephemeral.address);
    const receipt = await tx.wait();
    const opened = receipt.logs.map((l) => manager.interface.parseLog(l)).find((e) => e?.name === "SessionOpened");
    const sessionId = opened.args.sessionId;
    await advance(3 * MINUTE);

    const checkIns = [];
    const manual = [];
    for (const i of course.students) {
      if (random() >= STUDENTS[i].rate) {
        totals.absent++;
        continue;
      }
      // A few students each term have a flat phone battery and are marked by hand.
      if (random() < 0.06) {
        manual.push(studentIds[i]);
        continue;
      }
      await advance(10 + Math.floor(random() * 30));
      const issuedAt = await latestTimestamp();
      const ticketSig = await ephemeral.signTypedData(domain, TICKET_TYPES, { sessionId, issuedAt });
      const student = studentSigners[i];
      const studentSig = await student.signTypedData(domain, CHECKIN_TYPES, {
        sessionId,
        student: student.address,
        issuedAt,
        ticketHash: ethers.keccak256(ticketSig),
      });
      checkIns.push({ student: student.address, issuedAt, ticketSig, studentSig });
    }

    await advance(15 * MINUTE);
    if (checkIns.length) await (await manager.connect(teacher).submitCheckIns(sessionId, checkIns)).wait();
    if (manual.length) await (await manager.connect(teacher).markManual(sessionId, manual)).wait();
    await advance(SESSION_DURATION - 15 * MINUTE);
    await (await manager.connect(teacher).finalizeSession(sessionId)).wait();

    const { attendeeCount } = await manager.getSession(sessionId);
    if (Number(attendeeCount) !== checkIns.length + manual.length) {
      throw new Error(`Session ${sessionId} recorded ${attendeeCount}, expected ${checkIns.length + manual.length}`);
    }
    totals.sessions++;
    totals.checkIns += checkIns.length;
    totals.manual += manual.length;
  }
  console.log(
    `Ran ${totals.sessions} sessions: ${totals.checkIns} QR check-ins, ${totals.manual} manual, ${totals.absent} absences`,
  );

  // Redemptions: three fulfilled, one pending, one cancelled.
  await advance(DAY);
  const storeAddr = await store.getAddress();
  const redeem = async (studentIndex, itemId, { permit = false } = {}) => {
    const student = studentSigners[studentIndex];
    const { price } = await store.getItem(itemId);
    const balance = await token.balanceOf(student.address);
    if (balance < price) {
      throw new Error(`${STUDENTS[studentIndex].name} has ${ethers.formatEther(balance)} ATC, needs ${ethers.formatEther(price)}`);
    }
    let tx;
    if (permit) {
      const deadline = (await latestTimestamp()) + HOUR;
      const nonce = await token.nonces(student.address);
      const permitDomain = { name: "AttendCoin", version: "1", chainId: domainChainId, verifyingContract: AttendCoin };
      const sig = ethers.Signature.from(
        await student.signTypedData(permitDomain, PERMIT_TYPES, {
          owner: student.address,
          spender: storeAddr,
          value: price,
          nonce,
          deadline,
        }),
      );
      tx = await store.connect(student).redeemWithPermit(itemId, deadline, sig.v, sig.r, sig.s);
    } else {
      await (await token.connect(student).approve(storeAddr, price)).wait();
      tx = await store.connect(student).redeem(itemId);
    }
    const receipt = await tx.wait();
    const event = receipt.logs.map((l) => store.interface.parseLog(l)).find((e) => e?.name === "Redeemed");
    return event.args.redemptionId;
  };

  const voucher = await redeem(0, 1n);
  const waiver = await redeem(2, 3n, { permit: true });
  const printing = await redeem(1, 2n);
  await advance(HOUR);
  await (await store.connect(vendor).fulfill(voucher)).wait();
  await (await store.connect(vendor).fulfill(waiver)).wait();
  await (await store.connect(vendor).fulfill(printing)).wait();
  await advance(DAY);
  await redeem(4, 4n);
  const cancelled = await redeem(3, 1n);
  await (await store.connect(studentSigners[3]).cancel(cancelled)).wait();
  console.log("Made 5 redemptions: 3 fulfilled, 1 pending, 1 cancelled");

  // Bring the chain up to the wall clock so live check-ins line up with phone time.
  await advanceTo(Math.floor(Date.now() / 1000));

  const liveSigner = ethers.Wallet.createRandom();
  const liveTeacher = signers[COURSES[0].teacher];
  const liveTx = await manager.connect(liveTeacher).openSession(courseIds[0], LIVE_SESSION_DURATION, liveSigner.address);
  const liveReceipt = await liveTx.wait();
  const live = liveReceipt.logs.map((l) => manager.interface.parseLog(l)).find((e) => e?.name === "SessionOpened");
  console.log(`Left session ${live.args.sessionId} open on ${COURSES[0].code} until ${new Date(Number(live.args.closesAt) * 1000).toISOString()}`);

  const summaryFile = deploymentFile.replace(/\.json$/, ".seed.json");
  const summary = {
    network: network.name,
    chainId,
    seededAt: new Date().toISOString(),
    students: studentSigners.map((s, i) => ({ studentId: Number(studentIds[i]), account: 4 + i, wallet: s.address })),
    courses: COURSES.map((c, i) => ({ courseId: Number(courseIds[i]), code: c.code, teacher: signers[c.teacher].address })),
    liveSession: {
      courseId: Number(courseIds[0]),
      sessionId: Number(live.args.sessionId),
      signer: liveSigner.address,
      // Dev chain only: lets a demo page sign QR tickets for the session the seed opened.
      signerPrivateKey: liveSigner.privateKey,
      closesAt: Number(live.args.closesAt),
    },
  };
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2) + "\n");
  console.log(`Wrote ${path.relative(process.cwd(), summaryFile)}`);

  for (let i = 0; i < STUDENTS.length; i++) {
    const balance = await token.balanceOf(studentSigners[i].address);
    console.log(`  ${STUDENTS[i].rollNumber} ${STUDENTS[i].name.padEnd(16)} ${ethers.formatEther(balance).padStart(6)} ATC`);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exitCode = 1;
});
