const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const path = require("node:path");
const { writeFileSync } = require("node:fs");
const local = (file) => require(path.join(process.cwd(), file));
const database = new URL(process.env.DATABASE_URL);
const site = new URL(process.env.TEST_SITE ?? "http://127.0.0.1:3083");
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.pathname, "/pt_roadmap_fixture");
assert.equal(site.hostname, "127.0.0.1");
const { PrismaClient } = local("node_modules/@prisma/client");
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const { emptyState } = local("src/lib/placement/engine.ts");
const { confirmedPlacementSchema } = local("src/lib/roadmap/placement-proposal.ts");
const db = new PrismaClient();
const url = (p) => new URL(p, site).href;
const at = "2026-11-28T10:00:00.000Z", confirmed = new Date(at);
const attemptId = "pt37-roadmap-fixture", version = "pt37-roadmap-fixture-v1";
const t = { conditional: "g-b1-second-conditional", past: "g-b1-past-perfect", articles: "g-b1-articles-general" };
const grammar = {
  conditional: [
    ["If she ___ more time, she would travel.", "had", "has"],
    ["If I lived near the sea, I ___ every day.", "would swim", "will swim"],
    ["What would you do if you ___ the key?", "lost", "lose"],
    ["If he knew the answer, he ___ us.", "would tell", "tells"],
  ],
  past: [
    ["By the time she arrived, the bus ___.", "had left", "leaves"],
    ["He was tired because he ___ all night.", "had worked", "works"],
    ["I recognised the book because I ___ it before.", "had read", "read it tomorrow"],
  ],
};
const questions = Object.entries(grammar).flatMap(([group, entries]) => entries.map(([q, exact, wrong], index) => ({
  id: group + "-" + (index + 1), skill: "grammar", type: "mcq", level: "B1", band: 0, topic_id: t[group], topic_en: group, topic_ru: group,
  q, options: [exact, wrong], answer: 0, explain_ru: "Синтетический пример",
})));
const answers = Object.fromEntries(questions.map((q, index) => {
  const chosen = index > 0 && index < 4 ? 1 : 0;
  return [q.id, { v: chosen, ok: chosen === q.answer }];
}));
const fact = (group, verdict) => {
  const items = questions.filter(q => q.topic_id === t[group]);
  return { status: "checked", topicId: t[group], verdict, correct: items.filter(q => answers[q.id].ok).length, total: items.length,
    provenance: { scope: "initial", evidenceId: attemptId + "#state.answers:" + items[0].id + ".." + items.at(-1).id } };
};
const result = confirmedPlacementSchema.parse({
  attemptId, version, confirmedAt: at, level: "B1",
  topics: [fact("conditional", "gap"), fact("past", "secure"), {status:"unknown",topicId:t.articles,reason:"not-tested"}],
  skills: [
    {status:"checked",skill:"grammar",level:"B1",provenance:{scope:"initial",evidenceId:attemptId+"#state.core"}},
    {status:"unknown",skill:"reading",reason:"not-confirmed"}, {status:"unknown",skill:"speaking",reason:"not-confirmed"},
    {status:"unknown",skill:"listening",reason:"unknown-origin"}, {status:"unknown",skill:"writing",reason:"not-tested"},
    {status:"unknown",skill:"vocabulary",reason:"not-tested"},
  ],
});
const firstReading = local("content/placement/07_reading_B1.json").find((row)=>row.type==="reading" && row.level==="B1");
const state = {
  ...emptyState(), section:"done", level:"B1", step:4, parts:["core","reading"],
  items:Object.fromEntries([...questions,firstReading].map(q=>[q.id,q])),
  core:questions.map(q=>({id:q.id,step:4,ph:"w"})),
  answers:{...answers,...Object.fromEntries(firstReading.questions.map(q=>[q.id,{v:q.answer,ok:true}]))},
  reading:[firstReading.id],rdone:[firstReading.id],closed:["reading"],sdates:{core:confirmed.getTime(),reading:confirmed.getTime()},
};
const point = (id, title, topic, done) => ({
  id,title,level:"B1",hours:2,why:"",focus:"",topics:[topic],...(done?{done:true}:{}),
});
const stage = (title, points) => ({lvl:"B1",title,hours:points.length*2,grammar:points.map(p=>p.title),vocabulary:[],skills:[],points});

async function seed() {
  const teacher = await db.user.create({data:{role:"TEACHER",email:"pt37-teacher@example.invalid",name:"Fixture teacher",timezone:"UTC",teacherProfile:{create:{trialUntil:new Date("2099-01-01")}}}});
  const learner = await db.user.create({data:{role:"STUDENT",email:"pt37-learner@example.invalid",name:"Fixture learner",timezone:"UTC"}});
  const student = await db.student.create({data:{name:"Fixture learner",teacherId:teacher.id,userId:learner.id,status:"ACTIVE",level:"B1"}});
  const stages = [
    stage("Completed", [point("done","Already studied",t.past,true)]),
    stage("Current", [point("current","In progress",t.articles)]),
    stage("Future", [point("future-past","Past perfect",t.past),point("future-articles","Articles",t.articles),point("future-conditional","Second conditional",t.conditional)]),
  ];
  const roadmap = await db.roadmap.create({data:{studentId:student.id,type:"ge",goal:"B2",fromLevel:"B1",approvedAt:confirmed,stages}});
  const checkpoint = await db.checkpoint.create({data:{studentId:student.id,roadmapId:roadmap.id,kind:"entry",source:"placement",status:"done",level:"B1",assignedAt:confirmed,takenAt:confirmed,results:{placement:attemptId,skills:{grammar:57},shown:true}}});
  await db.checkpoint.create({data:{studentId:student.id,roadmapId:roadmap.id,kind:"slice",source:"manual",stage:1,status:"done",level:"B1",takenAt:confirmed,results:{grammar:80}}});
  await db.lessonProgress.createMany({data:[{owner:"s:"+student.id,templateId:"fixture-complete",state:"done"},{owner:"s:"+student.id,templateId:"fixture-paused",state:"paused"}]});
  await db.lessonInstance.createMany({data:[
    {studentId:student.id,teacherId:teacher.id,startsAt:confirmed,durationMin:60,status:"DONE",startedAt:confirmed,finishedAt:new Date("2026-11-28T11:00:00Z")},
    {studentId:student.id,teacherId:teacher.id,startsAt:new Date(Date.now()-60000),durationMin:60,status:"PLANNED",startedAt:new Date(Date.now()-60000)},
  ]});
  await db.placementAttempt.create({data:{id:attemptId,mode:"student",track:"adult",status:"reviewed",studentId:student.id,teacherId:teacher.id,
    checkpointId:checkpoint.id,token:randomUUID(),state,review:{rubric:2,roadmapResultV1:result},level:"B1",showResult:true,submittedAt:confirmed,reviewedAt:confirmed}});
  return {teacher,learner,student,roadmap,checkpoint};
}

async function main() {
  const f = await seed();
  const getAttempt = () => db.placementAttempt.findUniqueOrThrow({where:{id:attemptId}});
  const protectedRows = async () => ({
    route:await db.roadmap.findUniqueOrThrow({where:{id:f.roadmap.id}}),
    checkpoints:await db.checkpoint.findMany({where:{studentId:f.student.id},orderBy:{id:"asc"}}),
    progress:await db.lessonProgress.findMany({where:{owner:"s:"+f.student.id},orderBy:{id:"asc"}}),
    lessons:await db.lessonInstance.findMany({where:{studentId:f.student.id},orderBy:{id:"asc"}}),
    level:(await db.student.findUniqueOrThrow({where:{id:f.student.id},select:{level:true}})).level,
  });
  const baseline = await protectedRows();
  const unchanged = async (step) => {
    assert.deepEqual((await getAttempt()).review.roadmapResultV1, result);
    assert.deepEqual(await protectedRows(), baseline);
    console.log("PASS " + step + " preserves confirmed snapshot, Roadmap, progress, lesson history and Checkpoints");
  };
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE ?? "/usr/bin/chromium",args:["--no-sandbox"]});
  try {
    async function session(user) {
      const context = await browser.newContext({viewport:{width:1280,height:900}});
      await context.route("**/*", route => new URL(route.request().url()).origin===site.origin ? route.continue() : route.abort());
      const token=randomUUID();
      await db.session.create({data:{userId:user.id,tokenHash:createHash("sha256").update(token).digest("hex"),expiresAt:new Date(Date.now()+3600000)}});
      await context.addCookies([{name:"vo_session",value:token,url:url("/")},{name:"lang",value:"en",url:url("/")}]);
      const page = await context.newPage();
      page.setDefaultTimeout(90000);
      page.setDefaultNavigationTimeout(90000);
      page.on("dialog", dialog=>dialog.accept());
      return page;
    }
    const teacher = await session(f.teacher), learner = await session(f.learner);
    const proposalPage = "/teacher/students/"+f.student.id+"?tab=roadmap";
    const resultPage = "/student/test/"+f.checkpoint.id;
    const placementPage = "/teacher/placement/"+attemptId;
    const go = async (page, address) => assert.equal((await page.goto(url(address))).status(),200);
    const checkProposal = async () => {
      await go(teacher,proposalPage);
      const panel = teacher.getByRole("region",{name:"Suggested route update"});
      await panel.getByRole("link",{name:"Confirmed Placement Test result"}).waitFor();
      assert.equal(await panel.getByRole("link",{name:"Confirmed Placement Test result"}).getAttribute("href"),placementPage);
      await panel.locator('[title="'+version+'"]').getByText(/B1/).waitFor();
      await panel.getByText(/1\/4.*initial assessment/).waitFor();
      await panel.getByText(/Articles.*not tested/i).waitFor();
      await panel.getByText(/Speaking.*result not confirmed/i).waitFor();
      await panel.getByText(/Listening.*source unknown/i).waitFor();
      await panel.getByText(/Grammar · B1 · initial assessment/i).waitFor();
    };
    await checkProposal();
    await unchanged("Roadmap preview");
    await go(teacher,placementPage+"/report");
    await teacher.getByRole("button",{name:"Student report",exact:true}).waitFor();
    await teacher.getByRole("button",{name:"English",exact:true}).click();
    await teacher.evaluate(()=>{ window.print=()=>{ window.fixturePrinted = true; }; });
    await teacher.getByRole("button",{name:"Download PDF",exact:true}).click();
    await teacher.waitForFunction(()=>window.fixturePrinted === true);
    const pdf = await teacher.pdf({format:"A4",printBackground:true});
    assert.ok(pdf.length>1024);
    assert.match(pdf.subarray(0,8).toString(),/^%PDF-/);
    assert.ok((await getAttempt()).review.report.draftIds.student);
    await unchanged("report preparation / PDF and saving a draft");
    await teacher.getByRole("button",{name:"Send to the student's account",exact:true}).click();
    await teacher.getByText("The report was sent to the student.",{exact:true}).waitFor();
    const published = (await getAttempt()).review.report.publications.at(-1);
    assert.ok(published.id);
    await unchanged("report publication");
    await go(learner,resultPage);
    const sheet = learner.locator(".rpt-sheet,.rpt-hero").first();
    await sheet.waitFor();
    const initialReport = await sheet.innerText();

    await go(teacher,placementPage);
    const reading = teacher.locator("details.prblock").filter({has:teacher.getByText("Reading",{exact:true})}).filter({has:teacher.getByRole("button",{name:"more at B1",exact:true,includeHidden:true})});
    await reading.locator(":scope > summary").click();
    await reading.getByRole("button",{name:"more at B1",exact:true}).click();
    const deadline = Date.now()+20000;
    while ((await getAttempt()).status!=="active" && Date.now()<deadline) await new Promise(r=>setTimeout(r,100));
    const open = await getAttempt();
    assert.equal(open.status,"active");
    assert.equal(open.state.xt.kind,"reading");
    await unchanged("assigning a Reading retake");

    await go(learner,"/placement/"+attemptId);
    const item = open.state.items[open.state.reading.at(-1)];
    for(const question of item.questions) {
      await learner.getByLabel(question.options[question.answer],{exact:true}).first().check();
      const deadline = Date.now()+10000;
      while ((await getAttempt()).state.open?.[question.id]!==question.answer && Date.now()<deadline) await new Promise(r=>setTimeout(r,100));
      assert.equal((await getAttempt()).state.open?.[question.id],question.answer);
    }
    await learner.getByRole("button",{name:"Next",exact:true}).click();
    const submittedBy = Date.now()+20000;
    while ((await getAttempt()).status!=="submitted" && Date.now()<submittedBy) await new Promise(r=>setTimeout(r,100));
    const after = await getAttempt();
    assert.equal(after.status,"submitted");
    assert.ok(after.state.rdone.includes(item.id));
    assert.deepEqual(after.review.report.publications.at(-1),published);
    await unchanged("submitting the Reading retake");
    await go(learner,resultPage);
    assert.equal(await sheet.innerText(),initialReport);
    await checkProposal();
    await unchanged("Roadmap preview and published report after retake");
    const output={site:site.origin,teacherRoadmapPath:proposalPage,teacherPlacementPath:placementPage,studentReportPath:resultPage,checkpointId:f.checkpoint.id,
      result,publishedReportVersion:published.id,retakeItemId:item.id};
    if(process.env.RESULT_JSON) writeFileSync(process.env.RESULT_JSON,JSON.stringify(output,null,2)+"\n");
    console.log(JSON.stringify(output));
  } finally { await browser.close(); }
}

main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>db.$disconnect());
